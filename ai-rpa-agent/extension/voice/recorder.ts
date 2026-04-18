import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("voice");

/**
 * Step 1 of the agent loop: pure perception.
 *
 * Responsibility: capture raw microphone audio and surface a structured
 * `voice_captured` event with a correlation id generated at capture start.
 *
 * Invariants:
 *   - No DOM mutation, no network, no LLM, no backend calls.
 *   - No imports from `extension/background/`, `extension/controller/`,
 *     or `extension/content/`.
 *   - Reusable in any MV3 context that exposes `MediaRecorder` and
 *     `navigator.mediaDevices` (e.g. content script or dedicated page).
 *   - Deterministic shape: identical inputs produce identical event envelopes.
 */

export interface VoiceCapturedEvent {
  readonly type: "voice_captured";
  readonly timestamp: number;
  readonly correlationId: string;
  readonly audioBlob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
  /** Raw base64 from the content script when available (side panel can forward for transcription). */
  readonly base64?: string;
}

export type VoiceDataCallback = (chunk: Blob) => void;
export type VoiceStopCallback = (event: VoiceCapturedEvent) => void;

export type Unsubscribe = () => void;

const DEFAULT_MIME_TYPE = "audio/webm";

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private correlationId: string | null = null;

  private dataCallbacks: VoiceDataCallback[] = [];
  private stopCallbacks: VoiceStopCallback[] = [];

  /** True while a recording is actively in progress. */
  isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  /**
   * Subscribe to raw audio chunks as they become available from
   * `MediaRecorder.dataavailable`. Pure observation — no mutation, no
   * decoding. Returns an unsubscribe function.
   */
  onData(callback: VoiceDataCallback): Unsubscribe {
    this.dataCallbacks.push(callback);
    return () => {
      this.dataCallbacks = this.dataCallbacks.filter((c) => c !== callback);
    };
  }

  /**
   * Subscribe to the final `VoiceCapturedEvent` emitted when recording
   * stops. Returns an unsubscribe function.
   */
  onStop(callback: VoiceStopCallback): Unsubscribe {
    this.stopCallbacks.push(callback);
    return () => {
      this.stopCallbacks = this.stopCallbacks.filter((c) => c !== callback);
    };
  }

  /**
   * Acquire the microphone, start `MediaRecorder`, and allocate a fresh
   * `correlationId` that threads the rest of the agent loop.
   *
   * The correlation id is returned so the caller can propagate it through
   * subsequent `ExtensionMessage`s without waiting for `stopRecording()`.
   */
  async startRecording(): Promise<string> {
    if (this.isRecording()) {
      throw new Error("already_recording");
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("media_devices_unavailable");
    }

    const correlationId = newCorrelationId();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);

    this.correlationId = correlationId;
    this.stream = stream;
    this.recorder = recorder;
    this.chunks = [];
    this.startedAt = Date.now();

    recorder.addEventListener("dataavailable", (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      this.chunks.push(ev.data);
      for (const cb of this.dataCallbacks) cb(ev.data);
    });

    recorder.start();
    log.info("recording started", undefined, correlationId);
    return correlationId;
  }

  /**
   * Stop the active recording, release the microphone stream, and return
   * the assembled `VoiceCapturedEvent`. Registered `onStop` callbacks fire
   * with the same event before the promise resolves.
   *
   * Does NOT transcribe, compress, or otherwise alter the audio payload.
   */
  async stopRecording(): Promise<VoiceCapturedEvent> {
    const recorder = this.recorder;
    const correlationId = this.correlationId;
    const startedAt = this.startedAt;

    if (!recorder || !correlationId) {
      throw new Error("not_recording");
    }

    if (recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      recorder.stop();
      await stopped;
    }

    this.stream?.getTracks().forEach((t) => t.stop());

    const mimeType =
      recorder.mimeType && recorder.mimeType.length > 0 ? recorder.mimeType : DEFAULT_MIME_TYPE;
    const audioBlob = new Blob(this.chunks, { type: mimeType });
    const stoppedAt = Date.now();
    const durationMs = Math.max(0, stoppedAt - startedAt);

    const event: VoiceCapturedEvent = Object.freeze({
      type: "voice_captured",
      timestamp: startedAt,
      correlationId,
      audioBlob,
      mimeType,
      durationMs,
    });

    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.correlationId = null;
    this.startedAt = 0;

    for (const cb of this.stopCallbacks) cb(event);
    log.info(
      "recording stopped",
      { durationMs, sizeBytes: audioBlob.size, mimeType },
      correlationId,
    );
    return event;
  }
}
