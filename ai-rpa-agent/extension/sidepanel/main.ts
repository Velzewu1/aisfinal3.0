import { VoiceRecorder } from "../voice/index.js";
import { newCorrelationId } from "../shared/correlation.js";
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
      const audioData = await capture.audioBlob.arrayBuffer();
      const voiceRes = (await chrome.runtime.sendMessage({
        type: "voice_captured",
        correlationId: capture.correlationId,
        audio: {
          mimeType: capture.mimeType,
          sizeBytes: capture.audioBlob.size,
          durationMs: capture.durationMs,
          data: audioData,
        },
      })) as { ok: boolean; error?: string; result?: VoicePipelineResult };

      appendLog(
        `voice_captured ${capture.correlationId} (${capture.durationMs}ms, ${capture.audioBlob.size}B)`,
      );

      if (!voiceRes.ok) {
        appendLog(`voice_pipeline_failed ${capture.correlationId}: ${voiceRes.error ?? "unknown"}`);
        return;
      }

      const vr = voiceRes.result;
      if (!vr?.accepted) {
        if (vr?.step === "config" && vr.error) {
          appendLog(vr.error);
        } else if (vr?.error) {
          const prefix =
            vr.step === "preprocess"
              ? "audio_preprocessing_failed"
              : vr.step === "transcribe"
                ? "transcription_failed"
                : "voice_pipeline_failed";
          appendLog(`${prefix} ${capture.correlationId}: ${vr.error}`);
        }
        return;
      }

      appendLog(`text_transcribed ${capture.correlationId}: ${vr.text}`);
      try {
        await chrome.runtime.sendMessage({
          type: "user_utterance",
          correlationId: capture.correlationId,
          text: vr.text,
          transcribedDurationMs: vr.durationMs,
        });
        appendLog(`user_utterance ${capture.correlationId} dispatched`);
      } catch (err: unknown) {
        appendLog(`dispatch_failed ${capture.correlationId}: ${String(err)}`);
      }
    } catch (err: unknown) {
      appendLog(`stop failed: ${String(err)}`);
    }
  })();
});

type VoicePipelineResult =
  | { accepted: true; text: string; durationMs: number }
  | {
      accepted: false;
      step?: "config" | "preprocess" | "transcribe";
      error: string;
    };

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
