import { createLogger } from "../shared/logger.js";

const log = createLogger("content.recorder");

const DEFAULT_MIME = "audio/webm;codecs=opus";

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let activeCorrelationId: string | null = null;
let startedAt = 0;
let chunks: Blob[] = [];

async function handleStart(correlationId: string): Promise<void> {
  if (mediaRecorder !== null && mediaRecorder.state === "recording") {
    throw new Error("already_recording");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("media_devices_unavailable");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  chunks = [];
  activeCorrelationId = correlationId;
  startedAt = Date.now();

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(250);
  mediaRecorder = recorder;
  mediaStream = stream;
  log.info("mic recording started", undefined, correlationId);
}

async function handleStop(correlationId: string): Promise<void> {
  if (correlationId !== activeCorrelationId) {
    throw new Error("correlation_mismatch");
  }
  const recorder = mediaRecorder;
  const stream = mediaStream;
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  const startTs = startedAt;
  const cid = correlationId;
  const mimeType =
    recorder.mimeType && recorder.mimeType.length > 0 ? recorder.mimeType : DEFAULT_MIME;

  await new Promise<void>((resolve, reject) => {
    recorder.addEventListener(
      "stop",
      () => {
        const blob = new Blob(chunks, { type: mimeType });

        stream?.getTracks().forEach((t) => t.stop());

        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (!base64) {
            reject(new Error("no_base64_data"));
            return;
          }
          chrome.runtime.sendMessage(
            {
              type: "audio_complete",
              correlationId: cid,
              mimeType,
              startedAt: startTs,
              base64,
            },
            () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve();
            },
          );
        };
        reader.onerror = () => reject(new Error("filereader_failed"));
        reader.readAsDataURL(blob);
      },
      { once: true },
    );

    recorder.stop();
  });

  mediaRecorder = null;
  mediaStream = null;
  chunks = [];
  activeCorrelationId = null;
  startedAt = 0;
  log.info("mic recording complete", { mimeType }, cid);
}

type MicMsg =
  | { type: "start_mic_recording"; correlationId: string }
  | { type: "stop_mic_recording"; correlationId: string };

function isMicMsg(msg: unknown): msg is MicMsg {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: unknown; correlationId?: unknown };
  if (m.type === "start_mic_recording") {
    return typeof m.correlationId === "string" && m.correlationId.length > 0;
  }
  if (m.type === "stop_mic_recording") {
    return typeof m.correlationId === "string" && m.correlationId.length > 0;
  }
  return false;
}

/**
 * Mic capture runs in the content script (page context) so getUserMedia is
 * allowed when the mock UI tab (e.g. localhost:5173) is active.
 */
export function initMicRecorder(): void {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (!isMicMsg(msg)) return false;

      if (msg.type === "start_mic_recording") {
        void handleStart(msg.correlationId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      if (msg.type === "stop_mic_recording") {
        void handleStop(msg.correlationId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      return false;
    },
  );
  log.info("mic recorder initialized", { url: typeof location !== "undefined" ? location.href : "" });
}
