import { createLogger } from "../shared/logger.js";
import { newCorrelationId } from "../shared/correlation.js";

const log = createLogger("content.recorder");

const DEFAULT_MIME = "audio/webm;codecs=opus";

/**
 * VAD tuning for continuous listening mode. The AI vs deterministic-execution
 * boundary is preserved: VAD is a purely deterministic audio-level gate; it
 * never decides on intent. It only decides WHEN to emit a finished audio
 * segment to the existing perception pipeline.
 */
const VOICE_LEVEL_THRESHOLD = 10;
const SILENCE_DURATION_MS = 1500;
const MIN_SPEECH_DURATION_MS = 500;
const VAD_TICK_MS = 50;

function pickSupportedMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) {
      return m;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Push-to-talk (single-shot) recording — unchanged public behaviour.
// ---------------------------------------------------------------------------

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
    log.error("mic_error", { kind: "media_devices_unavailable" }, correlationId);
    throw new Error("media_devices_unavailable");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("mic_error", { kind: "getUserMedia", name: err instanceof Error ? err.name : "", message }, correlationId);
    throw err instanceof Error ? err : new Error(message);
  }
  log.info("mic_start", { mode: "ptt", url: location.href }, correlationId);
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

// ---------------------------------------------------------------------------
// Continuous (always-on) recording with Voice Activity Detection.
// ---------------------------------------------------------------------------

interface ContinuousState {
  sessionId: string;
  stream: MediaStream;
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  levelBuffer: Uint8Array<ArrayBuffer>;
  tickTimer: number | null;
  /** Active MediaRecorder for the CURRENT speech segment, or null between segments. */
  recorder: MediaRecorder | null;
  segmentChunks: Blob[];
  segmentCorrelationId: string | null;
  segmentStartedAt: number;
  lastSoundAt: number;
  isSpeaking: boolean;
  /** Set when stop has been requested so pending segments are dropped. */
  stopping: boolean;
}

let continuousState: ContinuousState | null = null;

/** Tear down when continuous session ends (visibility / AudioContext state listeners). */
let continuousLifecycleCleanup: (() => void) | null = null;

function computeAudioLevel(state: ContinuousState): number {
  state.analyser.getByteFrequencyData(state.levelBuffer);
  let sum = 0;
  for (let i = 0; i < state.levelBuffer.length; i += 1) {
    sum += state.levelBuffer[i] ?? 0;
  }
  return sum / state.levelBuffer.length;
}

function startSegmentRecorder(state: ContinuousState): void {
  if (state.recorder && state.recorder.state !== "inactive") return;

  log.info("mic_restart_attempt", { sessionId: state.sessionId }, state.sessionId);

  const mime = pickSupportedMime();
  const recorder = mime.length > 0
    ? new MediaRecorder(state.stream, { mimeType: mime })
    : new MediaRecorder(state.stream);

  state.segmentChunks = [];
  state.segmentCorrelationId = newCorrelationId();
  state.segmentStartedAt = Date.now();

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) state.segmentChunks.push(e.data);
  };

  recorder.start(250);
  state.recorder = recorder;
}

function finalizeSegmentRecorder(state: ContinuousState, publish: boolean): void {
  const recorder = state.recorder;
  const cid = state.segmentCorrelationId;
  const segStart = state.segmentStartedAt;
  const sessionId = state.sessionId;

  if (!recorder || !cid) {
    state.recorder = null;
    state.segmentChunks = [];
    state.segmentCorrelationId = null;
    return;
  }

  const segChunks = state.segmentChunks;
  const mimeType =
    recorder.mimeType && recorder.mimeType.length > 0 ? recorder.mimeType : DEFAULT_MIME;

  state.recorder = null;
  state.segmentChunks = [];
  state.segmentCorrelationId = null;

  recorder.addEventListener(
    "stop",
    () => {
      log.info("mic_end", { sessionId, correlationId: cid, publish, chunkCount: segChunks.length }, cid);
      if (!publish || segChunks.length === 0) return;
      const blob = new Blob(segChunks, { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (!base64) return;
        log.info("mic_result", { sessionId, correlationId: cid, mimeType, bytes: blob.size }, cid);
        chrome.runtime.sendMessage({
          type: "audio_complete",
          correlationId: cid,
          sessionId,
          mimeType,
          startedAt: segStart,
          base64,
        });
      };
      reader.readAsDataURL(blob);
    },
    { once: true },
  );

  try {
    recorder.stop();
  } catch {
    // recorder may already be inactive; ignore.
  }
}

function vadTick(): void {
  const state = continuousState;
  if (!state || state.stopping) return;

  const now = Date.now();
  const level = computeAudioLevel(state);

  if (level > VOICE_LEVEL_THRESHOLD) {
    state.lastSoundAt = now;
    if (!state.isSpeaking) {
      state.isSpeaking = true;
      startSegmentRecorder(state);
    }
  } else if (state.isSpeaking) {
    const silenceFor = now - state.lastSoundAt;
    if (silenceFor >= SILENCE_DURATION_MS) {
      const speechDurationMs = Math.max(0, state.lastSoundAt - state.segmentStartedAt);
      const publish = speechDurationMs >= MIN_SPEECH_DURATION_MS;
      state.isSpeaking = false;
      finalizeSegmentRecorder(state, publish);
    }
  }
}

async function handleStartContinuous(sessionId: string): Promise<void> {
  if (continuousState !== null) {
    throw new Error("already_continuous");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    log.error("mic_error", { kind: "media_devices_unavailable" }, sessionId);
    throw new Error("media_devices_unavailable");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("mic_error", { kind: "getUserMedia", name: err instanceof Error ? err.name : "", message }, sessionId);
    throw err instanceof Error ? err : new Error(message);
  }
  const AudioCtxCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  if (!AudioCtxCtor) {
    stream.getTracks().forEach((t) => t.stop());
    log.error("mic_error", { kind: "audio_context_unavailable" }, sessionId);
    throw new Error("audio_context_unavailable");
  }

  const audioCtx = new AudioCtxCtor();
  try {
    await audioCtx.resume();
  } catch (err: unknown) {
    log.error(
      "mic_error",
      { kind: "audio_ctx_resume", message: err instanceof Error ? err.message : String(err) },
      sessionId,
    );
  }

  const onCtxState = (): void => {
    if (audioCtx.state === "suspended") {
      log.error("mic_error", { kind: "audio_context_suspended" }, sessionId);
    }
  };
  audioCtx.addEventListener("statechange", onCtxState);

  const onVisibility = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    void audioCtx.resume().catch((err: unknown) => {
      log.error("mic_error", { kind: "visibility_resume_failed", message: String(err) }, sessionId);
    });
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  continuousLifecycleCleanup = () => {
    audioCtx.removeEventListener("statechange", onCtxState);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };

  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.4;
  source.connect(analyser);

  log.info("mic_start", { sessionId, audioCtxState: audioCtx.state, url: location.href }, sessionId);

  continuousState = {
    sessionId,
    stream,
    audioCtx,
    analyser,
    source,
    levelBuffer: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    tickTimer: null,
    recorder: null,
    segmentChunks: [],
    segmentCorrelationId: null,
    segmentStartedAt: 0,
    lastSoundAt: 0,
    isSpeaking: false,
    stopping: false,
  };

  continuousState.tickTimer = window.setInterval(vadTick, VAD_TICK_MS);
  log.info("continuous recording started", { sessionId });
}

async function handleStopContinuous(sessionId: string): Promise<void> {
  const state = continuousState;
  if (!state) return;
  if (state.sessionId !== sessionId) {
    throw new Error("session_mismatch");
  }

  continuousLifecycleCleanup?.();
  continuousLifecycleCleanup = null;

  state.stopping = true;
  if (state.tickTimer !== null) {
    window.clearInterval(state.tickTimer);
    state.tickTimer = null;
  }

  if (state.recorder && state.isSpeaking) {
    const speechDurationMs = Math.max(0, Date.now() - state.segmentStartedAt);
    const publish = speechDurationMs >= MIN_SPEECH_DURATION_MS;
    finalizeSegmentRecorder(state, publish);
  } else if (state.recorder) {
    finalizeSegmentRecorder(state, false);
  }

  state.isSpeaking = false;

  try {
    await state.audioCtx.close();
  } catch {
    // ignore
  }
  state.stream.getTracks().forEach((t) => t.stop());

  continuousState = null;
  log.info("continuous recording stopped", { sessionId });
}

// ---------------------------------------------------------------------------
// Message plumbing.
// ---------------------------------------------------------------------------

type MicMsg =
  | { type: "start_mic_recording"; correlationId: string }
  | { type: "stop_mic_recording"; correlationId: string }
  | { type: "start_continuous_mic"; sessionId: string }
  | { type: "stop_continuous_mic"; sessionId: string };

function isMicMsg(msg: unknown): msg is MicMsg {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: unknown; correlationId?: unknown; sessionId?: unknown };
  if (m.type === "start_mic_recording" || m.type === "stop_mic_recording") {
    return typeof m.correlationId === "string" && m.correlationId.length > 0;
  }
  if (m.type === "start_continuous_mic" || m.type === "stop_continuous_mic") {
    return typeof m.sessionId === "string" && m.sessionId.length > 0;
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

      if (msg.type === "start_continuous_mic") {
        void handleStartContinuous(msg.sessionId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      if (msg.type === "stop_continuous_mic") {
        void handleStopContinuous(msg.sessionId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      return false;
    },
  );
  log.info("mic recorder initialized", { url: typeof location !== "undefined" ? location.href : "" });
}
