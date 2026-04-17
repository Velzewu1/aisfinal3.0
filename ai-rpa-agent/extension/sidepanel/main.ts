import { VoiceRecorder } from "../voice/index.js";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";


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
    } catch (err: unknown) {
      appendLog(`stop failed: ${String(err)}`);
    }
  })();
});

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
