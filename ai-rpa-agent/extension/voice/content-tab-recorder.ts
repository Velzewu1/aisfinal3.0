import type { VoiceCapturedEvent } from "./recorder.js";
import { newCorrelationId } from "../shared/correlation.js";

/**
 * Records via the active tab's content script (localhost:5173 mock UI) so
 * getUserMedia runs in a context that supports microphone capture.
 */

type CompleteMeta = { mimeType: string; startedAt: number };

function unwrapSendMessageResponse<T>(raw: unknown): T {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid_extension_response");
  }
  const obj = raw as { ok?: unknown; error?: unknown; result?: unknown };
  if (obj.ok !== true) {
    const err = typeof obj.error === "string" ? obj.error : "extension_request_failed";
    throw new Error(err);
  }
  if (obj.result === undefined) {
    throw new Error("invalid_extension_response");
  }
  return obj.result as T;
}

/** Decode base64 to a Blob (binary-safe; matches WebM/opus byte layout). */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i += 1) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType || "audio/webm;codecs=opus" });
}

export class ContentTabVoiceRecorder {
  private activeCorrelationId: string | null = null;
  private base64Chunks: string[] = [];
  private pendingComplete: {
    correlationId: string;
    resolve: (v: CompleteMeta) => void;
    reject: (e: Error) => void;
  } | null = null;

  constructor() {
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
  }

  private readonly onRuntimeMessage = (msg: unknown): void => {
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as {
      type?: string;
      correlationId?: string;
      chunk?: string;
      mimeType?: string;
      startedAt?: number;
      base64?: string;
    };

    if (
      m.type === "audio_chunk_forward" &&
      m.correlationId === this.activeCorrelationId &&
      typeof m.chunk === "string"
    ) {
      this.base64Chunks.push(m.chunk);
      return;
    }

    if (
      m.type === "audio_complete_forward" &&
      m.correlationId === this.activeCorrelationId &&
      this.pendingComplete &&
      m.correlationId === this.pendingComplete.correlationId
    ) {
      const mimeType = typeof m.mimeType === "string" ? m.mimeType : "audio/webm";
      const startedAt = typeof m.startedAt === "number" ? m.startedAt : Date.now();
      if (typeof m.base64 === "string" && m.base64.length > 0) {
        this.base64Chunks = [m.base64];
      }
      this.pendingComplete.resolve({ mimeType, startedAt });
      this.pendingComplete = null;
    }
  };

  isRecording(): boolean {
    return this.activeCorrelationId !== null;
  }

  async startRecording(): Promise<string> {
    if (this.activeCorrelationId !== null) {
      throw new Error("already_recording");
    }
    const correlationId = newCorrelationId();
    this.base64Chunks = [];
    this.activeCorrelationId = correlationId;
    try {
      const raw = await chrome.runtime.sendMessage({
        type: "start_recording",
        correlationId,
      });
      unwrapSendMessageResponse<{ started: true }>(raw);
      return correlationId;
    } catch (err: unknown) {
      this.activeCorrelationId = null;
      this.base64Chunks = [];
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async stopRecording(): Promise<VoiceCapturedEvent> {
    const correlationId = this.activeCorrelationId;
    if (!correlationId) {
      throw new Error("not_recording");
    }

    const completePromise = new Promise<CompleteMeta>((resolve, reject) => {
      this.pendingComplete = { correlationId, resolve, reject };
    });
    const timeout = new Promise<CompleteMeta>((_, reject) => {
      setTimeout(() => reject(new Error("audio_complete_timeout")), 60_000);
    });

    try {
      const raw = await chrome.runtime.sendMessage({
        type: "stop_recording",
        correlationId,
      });
      unwrapSendMessageResponse<{ stopped: true }>(raw);
      const meta = await Promise.race([completePromise, timeout]);

      const b64 = this.base64Chunks[0];
      if (!b64 || b64.length === 0) {
        throw new Error("no_audio_base64");
      }
      const audioBlob = base64ToBlob(b64, meta.mimeType);
      const durationMs = Math.max(0, Date.now() - meta.startedAt);

      const event: VoiceCapturedEvent = Object.freeze({
        type: "voice_captured",
        timestamp: meta.startedAt,
        correlationId,
        audioBlob,
        mimeType: meta.mimeType,
        durationMs,
        base64: b64,
      });

      this.base64Chunks = [];
      this.activeCorrelationId = null;
      return event;
    } catch (err: unknown) {
      this.pendingComplete = null;
      this.base64Chunks = [];
      this.activeCorrelationId = null;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
