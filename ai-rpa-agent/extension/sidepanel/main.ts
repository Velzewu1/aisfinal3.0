import { VoiceRecorder, preprocessAudio, transcribeAudio } from "../voice/index.js";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";
import { suggestNext, SUGGESTION_TEXT } from "../controller/proactivity.js";
import type { AgentEvent, IntentKind } from "@ai-rpa/schemas";


const log = createLogger("sidepanel");
const recorder = new VoiceRecorder();
let lastCorrelationId: string | null = null;

const logEl = document.getElementById("log") as HTMLDivElement | null;
const recordBtn = document.getElementById("record") as HTMLButtonElement | null;
const stopBtn = document.getElementById("stop") as HTMLButtonElement | null;
const sendBtn = document.getElementById("send") as HTMLButtonElement | null;
const utterEl = document.getElementById("utter") as HTMLInputElement | null;
const acceptBtn = document.getElementById("accept") as HTMLButtonElement | null;
const rejectBtn = document.getElementById("reject") as HTMLButtonElement | null;

function appendLog(line: string): void {
  if (!logEl) return;
  logEl.textContent += `\n${line}`;
  logEl.scrollTop = logEl.scrollHeight;
}

recordBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      const correlationId = await recorder.startRecording();
      lastCorrelationId = correlationId;
      appendLog(`recording… ${correlationId}`);
    } catch (err: unknown) {
      log.error("record failed", String(err));
      appendLog(`record failed: ${String(err)}`);
    }
  })();
});

stopBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      const capture = await recorder.stopRecording();
      lastCorrelationId = capture.correlationId;
      await chrome.runtime.sendMessage({
        type: "voice_captured",
        correlationId: capture.correlationId,
        audio: {
          mimeType: capture.mimeType,
          sizeBytes: capture.audioBlob.size,
          durationMs: capture.durationMs,
        },
      });
      appendLog(
        `voice_captured ${capture.correlationId} (${capture.durationMs}ms, ${capture.audioBlob.size}B)`,
      );

      await runVoicePipeline(capture.correlationId, capture);
    } catch (err: unknown) {
      appendLog(`stop failed: ${String(err)}`);
    }
  })();
});

async function emitAgentEvent(event: AgentEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "event", event });
  } catch (err: unknown) {
    log.warn("emit failed", String(err), event.correlationId);
  }
}

async function readApiKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get("OPENAI_API_KEY");
    const key = stored["OPENAI_API_KEY"];
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch (err: unknown) {
    log.warn("storage read failed", String(err));
    return null;
  }
}

async function runVoicePipeline(
  correlationId: string,
  capture: Awaited<ReturnType<VoiceRecorder["stopRecording"]>>,
): Promise<void> {
  const apiKey = await readApiKey();
  if (!apiKey) {
    appendLog(
      "OPENAI_API_KEY missing in chrome.storage.local; run chrome.storage.local.set({ OPENAI_API_KEY: 'sk-...' })",
    );
    return;
  }

  let preprocessed;
  try {
    preprocessed = await preprocessAudio(capture);
  } catch (err: unknown) {
    appendLog(`audio_preprocessing_failed ${correlationId}: ${String(err)}`);
    return;
  }
  await emitAgentEvent({
    id: newCorrelationId(),
    type: "audio_preprocessed",
    correlationId,
    ts: nowIso(),
    payload: {
      durationMs: preprocessed.durationMs,
      mimeType: preprocessed.mimeType,
      sizeBytes: preprocessed.normalizedBlob.size,
      sampleRateHint: preprocessed.sampleRateHint,
    },
  });

  let transcribed;
  try {
    transcribed = await transcribeAudio(preprocessed, { apiKey });
  } catch (err: unknown) {
    appendLog(`transcription_failed ${correlationId}: ${String(err)}`);
    return;
  }
  appendLog(`text_transcribed ${correlationId}: ${transcribed.text}`);
  await emitAgentEvent({
    id: newCorrelationId(),
    type: "speech_to_text_completed",
    correlationId,
    ts: nowIso(),
    payload: {
      chars: transcribed.text.length,
      durationMs: transcribed.durationMs,
      ...(transcribed.language ? { language: transcribed.language } : {}),
    },
  });

  try {
    await chrome.runtime.sendMessage({
      type: "user_utterance",
      correlationId,
      text: transcribed.text,
    });
    appendLog(`user_utterance ${correlationId} dispatched`);
  } catch (err: unknown) {
    appendLog(`dispatch_failed ${correlationId}: ${String(err)}`);
  }
}

sendBtn?.addEventListener("click", () => {
  void (async () => {
    const text = utterEl?.value.trim() ?? "";
    if (!text) return;
    const correlationId = newCorrelationId();
    lastCorrelationId = correlationId;
    await chrome.runtime.sendMessage({ type: "user_utterance", correlationId, text });
    appendLog(`user_utterance ${correlationId}: ${text}`);
    if (utterEl) utterEl.value = "";
  })();
});

acceptBtn?.addEventListener("click", () => {
  void sendConfirmation(true);
});
rejectBtn?.addEventListener("click", () => {
  void sendConfirmation(false);
});

async function sendConfirmation(accepted: boolean): Promise<void> {
  if (!lastCorrelationId) {
    appendLog("no pending correlation id");
    return;
  }
  await chrome.runtime.sendMessage({
    type: "user_confirmation",
    correlationId: lastCorrelationId,
    accepted,
  });
  appendLog(`user_confirmation ${lastCorrelationId}: ${accepted}`);
}

// ------------------------------------------------------------------ //
// Step 10 — proactive UI hints.                                       //
//                                                                     //
// Listen for durable AgentEvents fan-out from the background router   //
// and surface a short nudge after an `execute` decision on a `fill`   //
// intent (e.g. "Осмотр заполнен. Сформировать расписание?").         //
//                                                                     //
// Purely presentational: no executions, no new messages emitted.      //
// ------------------------------------------------------------------ //

const intentByCorrelation = new Map<string, IntentKind>();

function isEventEnvelope(m: unknown): m is { type: "event"; event: AgentEvent } {
  if (m === null || typeof m !== "object") return false;
  const obj = m as { type?: unknown; event?: unknown };
  return obj.type === "event" && typeof obj.event === "object" && obj.event !== null;
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isEventEnvelope(msg)) return;
  const ev = msg.event;

  if (ev.type === "intent_parsed") {
    intentByCorrelation.set(ev.correlationId, ev.payload.interpretation.intent.kind);
    return;
  }

  if (ev.type === "decision_made") {
    const kind = intentByCorrelation.get(ev.correlationId);
    intentByCorrelation.delete(ev.correlationId);
    if (ev.payload.decision !== "execute" || kind !== "fill") return;
    const suggestion = suggestNext(kind);
    if (suggestion) appendLog(`hint: ${SUGGESTION_TEXT[suggestion]}`);
  }
});
