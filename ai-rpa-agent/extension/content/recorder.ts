import { createLogger } from "../shared/logger.js";
import { newCorrelationId } from "../shared/correlation.js";

const log = createLogger("content.recorder");

/**
 * Streaming microphone capture for the AI RPA perception layer.
 *
 * Responsibilities (perception only):
 *   - Acquire the mic exactly ONCE per session (getUserMedia).
 *   - Keep a single AudioContext + graph alive for the entire session.
 *   - Emit raw 16 kHz mono 16-bit PCM chunks every ~250 ms over
 *     `chrome.runtime.sendMessage` as `audio_chunk` (observability / future
 *     streaming STT).
 *   - Cut utterances by a purely deterministic **inactivity timer** (1.5 s
 *     of below-threshold energy after >= 300 ms of speech) and flush each
 *     utterance as a WAV blob through the existing `audio_complete` contract.
 *
 * Invariants (AI vs deterministic boundary):
 *   - No DOM mutation of the host page.
 *   - No LLM, no controller, no network beyond `chrome.runtime.sendMessage`.
 *   - VAD here is a pure signal-level gate; it never classifies intent.
 *   - Once a session is started, the mic stream, AudioContext, and worklet
 *     are not recreated between utterances.
 */

// ---------------------------------------------------------------------------
// Tuning (deterministic, no AI).
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_MS = 250;
const CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000; // 4000
const SILENCE_RMS = 0.012;
const INACTIVITY_MS = 1500;
const MIN_SPEECH_MS = 300;
const HEARTBEAT_MS = 5000;
const WAV_MIME = "audio/wav";

// ---------------------------------------------------------------------------
// Worklet (registered once per AudioContext via a Blob URL).
// ---------------------------------------------------------------------------

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    // Copy so the audio thread can reuse its buffer.
    this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

let workletBlobUrl: string | null = null;
function getWorkletUrl(): string {
  if (workletBlobUrl) return workletBlobUrl;
  const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
  workletBlobUrl = URL.createObjectURL(blob);
  return workletBlobUrl;
}

// ---------------------------------------------------------------------------
// Session state.
// ---------------------------------------------------------------------------

type SessionMode = "ptt" | "continuous";

interface StreamingSession {
  mode: SessionMode;
  /** For continuous mode: stable id for the whole session. For PTT: the
   *  caller-supplied correlationId (one utterance, one id). */
  sessionId: string;
  stream: MediaStream;
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  /** AudioWorkletNode or ScriptProcessorNode — both feed `onSamples`. */
  node: AudioNode;
  nodeKind: "worklet" | "script";

  /** Ring-like accumulator for the NEXT 250 ms chunk (already at 16 kHz). */
  chunkBuffer: Float32Array;
  chunkOffset: number;

  /** Fractional-sample phase used by the linear-interp downsampler. */
  resamplePhase: number;
  /** Last source sample retained for the next call (for interpolation). */
  resamplePrev: number;
  /** Source-rate sample count consumed (just for logging). */
  sourceSamplesSeen: number;

  /** Current utterance buffer (concatenated 16 kHz int16 chunks). */
  utteranceChunks: Int16Array[];
  utteranceSampleCount: number;
  utteranceStartedAt: number;
  utteranceCorrelationId: string | null;
  /** Time (performance.now()) of last above-threshold chunk. */
  lastActiveAt: number;
  /** True once we've seen any above-threshold energy in the current utterance. */
  hasSpeech: boolean;

  inactivityTimer: number | null;
  heartbeatTimer: number | null;
  startedAt: number;
  stopping: boolean;
  /** Keep cleanup handles so stop() is idempotent. */
  cleanupHandlers: Array<() => void>;
}

let session: StreamingSession | null = null;

// ---------------------------------------------------------------------------
// Public lifecycle.
// ---------------------------------------------------------------------------

async function startSession(mode: SessionMode, id: string): Promise<void> {
  if (session !== null) {
    throw new Error(mode === "continuous" ? "already_continuous" : "already_recording");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    log.error("mic_error", { kind: "media_devices_unavailable" }, id);
    throw new Error("media_devices_unavailable");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      "mic_error",
      { kind: "getUserMedia", name: err instanceof Error ? err.name : "", message },
      id,
    );
    throw err instanceof Error ? err : new Error(message);
  }

  const AudioCtxCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  if (!AudioCtxCtor) {
    stream.getTracks().forEach((t) => t.stop());
    log.error("mic_error", { kind: "audio_context_unavailable" }, id);
    throw new Error("audio_context_unavailable");
  }

  const audioCtx = new AudioCtxCtor();
  try {
    await audioCtx.resume();
  } catch (err: unknown) {
    log.warn(
      "audio_ctx_resume_failed",
      { message: err instanceof Error ? err.message : String(err) },
      id,
    );
  }

  const source = audioCtx.createMediaStreamSource(stream);
  const built = await buildCaptureNode(audioCtx, id);
  source.connect(built.node);
  // Keep the graph pulling samples even without a destination connection in
  // all browsers: route through a muted gain to ctx.destination.
  const silent = audioCtx.createGain();
  silent.gain.value = 0;
  built.node.connect(silent);
  silent.connect(audioCtx.destination);

  const s: StreamingSession = {
    mode,
    sessionId: id,
    stream,
    audioCtx,
    source,
    node: built.node,
    nodeKind: built.kind,
    chunkBuffer: new Float32Array(CHUNK_SAMPLES),
    chunkOffset: 0,
    resamplePhase: 0,
    resamplePrev: 0,
    sourceSamplesSeen: 0,
    utteranceChunks: [],
    utteranceSampleCount: 0,
    utteranceStartedAt: Date.now(),
    utteranceCorrelationId: mode === "ptt" ? id : null,
    lastActiveAt: performance.now(),
    hasSpeech: false,
    inactivityTimer: null,
    heartbeatTimer: null,
    startedAt: Date.now(),
    stopping: false,
    cleanupHandlers: [],
  };

  // Wire the raw PCM firehose into our accumulator.
  built.attach(s, (samples) => onSourceSamples(s, samples));

  // Keep the AudioContext alive independent of tab visibility. We resume on
  // visibility, but never suspend on hidden — the spec lets us stay running
  // while the tab is backgrounded as long as the page keeps the context.
  const onVisibility = (): void => {
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch((err: unknown) => {
        log.warn("visibility_resume_failed", { message: String(err) }, s.sessionId);
      });
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    s.cleanupHandlers.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  // Heartbeat so an always-on mic is observable in the logs.
  s.heartbeatTimer = window.setInterval(() => {
    if (!session || session !== s || s.stopping) return;
    log.info(
      "mic_stream_active",
      {
        mode: s.mode,
        sessionId: s.sessionId,
        ctxState: s.audioCtx.state,
        nodeKind: s.nodeKind,
        utteranceSamples: s.utteranceSampleCount,
      },
      s.sessionId,
    );
  }, HEARTBEAT_MS);

  session = s;

  log.info(
    "mic_stream_started",
    {
      mode,
      sessionId: id,
      sourceSampleRate: audioCtx.sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
      chunkMs: CHUNK_MS,
      nodeKind: built.kind,
      url: typeof location !== "undefined" ? location.href : "",
    },
    id,
  );

  // In continuous mode, pre-allocate the first utterance id so the first
  // sample already has somewhere to land.
  if (mode === "continuous") {
    beginUtterance(s);
  }
}

async function stopSession(mode: SessionMode, id: string): Promise<void> {
  const s = session;
  if (!s) return;
  if (s.mode !== mode) {
    throw new Error(mode === "continuous" ? "session_mismatch" : "correlation_mismatch");
  }
  if (mode === "continuous" && s.sessionId !== id) {
    throw new Error("session_mismatch");
  }
  if (mode === "ptt" && s.sessionId !== id) {
    throw new Error("correlation_mismatch");
  }

  s.stopping = true;

  if (s.inactivityTimer !== null) {
    window.clearTimeout(s.inactivityTimer);
    s.inactivityTimer = null;
  }
  if (s.heartbeatTimer !== null) {
    window.clearInterval(s.heartbeatTimer);
    s.heartbeatTimer = null;
  }

  // Flush any pending partial chunk into the utterance so we don't drop
  // trailing audio on stop.
  flushChunk(s, true);
  // Flush whatever utterance is in flight.
  finalizeUtterance(s, /* publish */ s.hasSpeech || s.mode === "ptt");

  try {
    s.source.disconnect();
  } catch {
    /* noop */
  }
  try {
    s.node.disconnect();
  } catch {
    /* noop */
  }
  for (const h of s.cleanupHandlers) {
    try {
      h();
    } catch {
      /* noop */
    }
  }
  try {
    await s.audioCtx.close();
  } catch {
    /* noop */
  }
  s.stream.getTracks().forEach((t) => t.stop());

  session = null;
  log.info("mic_stream_stopped", { mode, sessionId: id }, id);
}

// ---------------------------------------------------------------------------
// Capture node construction (AudioWorklet preferred, ScriptProcessor fallback).
// ---------------------------------------------------------------------------

interface BuiltNode {
  node: AudioNode;
  kind: "worklet" | "script";
  attach: (s: StreamingSession, onSamples: (samples: Float32Array) => void) => void;
}

async function buildCaptureNode(ctx: AudioContext, id: string): Promise<BuiltNode> {
  const workletHost = ctx as AudioContext & { audioWorklet?: AudioWorklet };
  if (workletHost.audioWorklet) {
    try {
      await workletHost.audioWorklet.addModule(getWorkletUrl());
      const node = new AudioWorkletNode(ctx, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      return {
        node,
        kind: "worklet",
        attach: (_s, onSamples) => {
          node.port.onmessage = (ev: MessageEvent): void => {
            const data = ev.data as Float32Array | undefined;
            if (data && data.length > 0) onSamples(data);
          };
        },
      };
    } catch (err: unknown) {
      log.warn(
        "worklet_init_failed_fallback_script",
        { message: err instanceof Error ? err.message : String(err) },
        id,
      );
    }
  }

  // ScriptProcessorNode fallback. 4096 frames ≈ 85 ms at 48 kHz — well under
  // the 250 ms chunking window and plenty for continuous streaming.
  const bufferSize = 4096;
  const proc = ctx.createScriptProcessor(bufferSize, 1, 1);
  return {
    node: proc,
    kind: "script",
    attach: (_s, onSamples) => {
      proc.onaudioprocess = (ev: AudioProcessingEvent): void => {
        const ch = ev.inputBuffer.getChannelData(0);
        // Copy: the underlying buffer is owned by the audio thread.
        const copy = new Float32Array(ch.length);
        copy.set(ch);
        onSamples(copy);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// PCM pipeline: downsample → chunk → energy gate → utterance assembly.
// ---------------------------------------------------------------------------

function onSourceSamples(s: StreamingSession, samples: Float32Array): void {
  if (s.stopping) return;

  const srcRate = s.audioCtx.sampleRate;
  const ratio = srcRate / TARGET_SAMPLE_RATE;

  // Linear interpolation decimation. `resamplePhase` is the fractional source
  // index where the NEXT output sample lives.
  let phase = s.resamplePhase;
  let prev = s.resamplePrev;
  s.sourceSamplesSeen += samples.length;

  while (phase < samples.length) {
    const i = Math.floor(phase);
    const frac = phase - i;
    const a = i === 0 ? prev : samples[i - 1] ?? 0;
    const b = samples[i] ?? 0;
    const out = a + (b - a) * frac;

    s.chunkBuffer[s.chunkOffset] = out;
    s.chunkOffset += 1;
    if (s.chunkOffset >= CHUNK_SAMPLES) {
      flushChunk(s, false);
    }
    phase += ratio;
  }

  s.resamplePhase = phase - samples.length;
  s.resamplePrev = samples[samples.length - 1] ?? prev;
}

function flushChunk(s: StreamingSession, force: boolean): void {
  const n = s.chunkOffset;
  if (n === 0) return;
  if (!force && n < CHUNK_SAMPLES) return;

  const float = s.chunkBuffer.subarray(0, n);
  const int16 = floatToInt16(float);
  const rms = computeRms(float);
  const now = performance.now();

  // Emit a raw PCM chunk regardless of speech/silence — the chunk stream is
  // an observability / future-streaming-STT surface. The utterance boundary
  // logic is separate.
  if (s.utteranceCorrelationId === null) beginUtterance(s);
  const cid = s.utteranceCorrelationId!;

  // Observability: always log that we produced a chunk.
  log.debug(
    "audio_chunk_emitted",
    { bytes: int16.byteLength, samples: n, rms: Number(rms.toFixed(4)) },
    cid,
  );

  // Accumulate into the current utterance.
  s.utteranceChunks.push(int16);
  s.utteranceSampleCount += int16.length;

  if (rms >= SILENCE_RMS) {
    s.lastActiveAt = now;
    s.hasSpeech = true;
  }

  // Send the chunk out. In continuous mode we attach the session id so the
  // sidepanel can route it; in PTT mode the correlationId carries it.
  const base64 = int16ToBase64(int16);
  chrome.runtime
    .sendMessage({
      type: "audio_chunk",
      correlationId: cid,
      chunk: base64,
      sessionId: s.mode === "continuous" ? s.sessionId : undefined,
      rms,
      sampleRate: TARGET_SAMPLE_RATE,
    })
    .then(() => {
      log.debug("audio_chunk_sent", { bytes: int16.byteLength }, cid);
    })
    .catch((err: unknown) => {
      // Chunk forwarding is best-effort — losing observability chunks must
      // never break utterance assembly.
      log.warn("audio_chunk_send_failed", { message: String(err) }, cid);
    });

  // Reset the chunk accumulator.
  s.chunkOffset = 0;

  // In continuous mode, arm / reset the inactivity flush timer.
  if (s.mode === "continuous" && !s.stopping) {
    scheduleInactivityCheck(s);
  }
}

function scheduleInactivityCheck(s: StreamingSession): void {
  if (s.inactivityTimer !== null) {
    window.clearTimeout(s.inactivityTimer);
    s.inactivityTimer = null;
  }
  s.inactivityTimer = window.setTimeout(() => {
    if (!session || session !== s || s.stopping) return;
    const now = performance.now();
    const silentFor = now - s.lastActiveAt;
    const utteranceMs = (s.utteranceSampleCount / TARGET_SAMPLE_RATE) * 1000;
    if (silentFor >= INACTIVITY_MS && s.hasSpeech && utteranceMs >= MIN_SPEECH_MS) {
      finalizeUtterance(s, true);
      beginUtterance(s);
    } else {
      // Re-arm; mic stays open regardless.
      scheduleInactivityCheck(s);
    }
  }, INACTIVITY_MS);
}

function beginUtterance(s: StreamingSession): void {
  s.utteranceChunks = [];
  s.utteranceSampleCount = 0;
  s.utteranceStartedAt = Date.now();
  s.utteranceCorrelationId = s.mode === "ptt" ? s.sessionId : newCorrelationId();
  s.lastActiveAt = performance.now();
  s.hasSpeech = false;
}

function finalizeUtterance(s: StreamingSession, publish: boolean): void {
  const cid = s.utteranceCorrelationId;
  const startedAt = s.utteranceStartedAt;
  const samples = s.utteranceSampleCount;
  const chunks = s.utteranceChunks;

  s.utteranceChunks = [];
  s.utteranceSampleCount = 0;
  s.utteranceCorrelationId = null;
  s.hasSpeech = false;

  if (!cid || samples === 0 || !publish) {
    return;
  }

  const utteranceMs = (samples / TARGET_SAMPLE_RATE) * 1000;
  if (s.mode === "continuous" && utteranceMs < MIN_SPEECH_MS) {
    log.info(
      "utterance_dropped_below_min",
      { durationMs: utteranceMs, minMs: MIN_SPEECH_MS, sessionId: s.sessionId },
      cid,
    );
    return;
  }

  const merged = concatInt16(chunks, samples);
  const wav = encodeMonoPcmWav(merged, TARGET_SAMPLE_RATE);
  const base64 = arrayBufferToBase64(wav);

  log.info(
    "utterance_flushed",
    {
      sessionId: s.sessionId,
      mimeType: WAV_MIME,
      bytes: wav.byteLength,
      durationMs: Math.round(utteranceMs),
    },
    cid,
  );

  chrome.runtime
    .sendMessage({
      type: "audio_complete",
      correlationId: cid,
      sessionId: s.mode === "continuous" ? s.sessionId : undefined,
      mimeType: WAV_MIME,
      startedAt,
      base64,
    })
    .catch((err: unknown) => {
      log.error("audio_complete_send_failed", { message: String(err) }, cid);
    });
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function concatInt16(parts: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeMonoPcmWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i] ?? 0, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function int16ToBase64(samples: Int16Array): string {
  // Copy into a fresh, non-shared ArrayBuffer so the return type stays
  // ArrayBuffer (some TS lib targets type TypedArray.buffer as
  // ArrayBuffer | SharedArrayBuffer).
  const copy = new ArrayBuffer(samples.byteLength);
  new Int16Array(copy).set(samples);
  return arrayBufferToBase64(copy);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Chrome message plumbing. Public shape is unchanged from the old recorder,
// so background/router.ts and the side panel keep working as-is.
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

export function initMicRecorder(): void {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (!isMicMsg(msg)) return false;

      if (msg.type === "start_mic_recording") {
        void startSession("ptt", msg.correlationId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
      if (msg.type === "stop_mic_recording") {
        void stopSession("ptt", msg.correlationId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
      if (msg.type === "start_continuous_mic") {
        void startSession("continuous", msg.sessionId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
      if (msg.type === "stop_continuous_mic") {
        void stopSession("continuous", msg.sessionId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
      return false;
    },
  );
  log.info("mic recorder initialized", {
    url: typeof location !== "undefined" ? location.href : "",
  });
}
