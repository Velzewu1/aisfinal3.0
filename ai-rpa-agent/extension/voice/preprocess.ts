import type { VoiceCapturedEvent } from "./recorder.js";
import { buildAgentEvent, publishAgentEvent } from "../shared/agent-event-publish.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("voice.preprocess");

/**
 * Step 2 of the agent loop: pure signal conditioning.
 *
 * Responsibility: turn a raw `VoiceCapturedEvent` into a normalized,
 * ASR-ready `PreprocessedAudioEvent`.
 *
 * Invariants:
 *   - Stateless, deterministic function. Same input buffer + same platform
 *     WebAudio implementation → same output bytes, same noise profile.
 *   - No DOM mutation, no network, no LLM, no backend.
 *     `chrome.runtime.sendMessage` is used only to publish `audio_preprocessed`
 *     (observability).
 *   - No imports from `extension/controller/`, `extension/llm/`,
 *     `extension/background/`, or `extension/content/`.
 *   - Emits `audio_preprocessed` only (observability); same payload as
 *     `packages/schemas` / controller pipeline.
 *
 * Output format note (deterministic re-encode path):
 *   WebAudio can only deterministically encode PCM. `MediaRecorder` can
 *   emit WebM/Ogg but runs in real time and is not byte-deterministic, so
 *   this module always emits 16-bit PCM mono WAV at `TARGET_SAMPLE_RATE`.
 *   That is also the canonical Whisper input shape for Step 3. Input that
 *   is already WAV at a higher rate is therefore *reduced* in size by the
 *   16 kHz mono downmix; compressed inputs (WebM/Ogg) will grow because
 *   decompression is inherent to this pipeline.
 */

const ALLOWED_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/wav", "audio/wave"] as const;

const TARGET_SAMPLE_RATE = 16_000;
const OUTPUT_MIME_TYPE = "audio/wav";

const SILENCE_THRESHOLD = 0.01;
const PEAK_TARGET = 0.97;
const MAX_GAIN = 8.0;

export interface AudioNoiseProfile {
  readonly rmsLevel: number;
  readonly silenceRatio: number;
}

export interface PreprocessedAudioEvent {
  readonly correlationId: string;
  readonly normalizedBlob: Blob;
  readonly mimeType: string;
  readonly sampleRateHint: number;
  readonly durationMs: number;
  readonly noiseProfile?: AudioNoiseProfile;
}

export class AudioFormatNotSupported extends Error {
  readonly receivedMimeType: string;
  constructor(mimeType: string) {
    super(`AudioFormatNotSupported: ${mimeType || "(empty)"}`);
    this.name = "AudioFormatNotSupported";
    this.receivedMimeType = mimeType;
  }
}

export class AudioPreprocessingUnavailable extends Error {
  constructor(reason: string) {
    super(`AudioPreprocessingUnavailable: ${reason}`);
    this.name = "AudioPreprocessingUnavailable";
  }
}

/**
 * Pure transform: `VoiceCapturedEvent → PreprocessedAudioEvent`.
 *
 * Pipeline:
 *   validate mime → decode → resample-to-mono-16kHz → compute noise profile
 *   → trim silence → peak-normalize gain → encode 16-bit PCM WAV
 */
export async function preprocessAudio(
  event: VoiceCapturedEvent,
): Promise<PreprocessedAudioEvent> {
  if (
    typeof AudioContext === "undefined" &&
    typeof (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === "undefined"
  ) {
    // AudioContext not available (content script context)
    // Return raw audio blob unchanged
    const mimeType = canonicalMimeType(event.mimeType) || event.mimeType;
    const normalizedBlob = event.audioBlob;
    const durationMs = event.durationMs;

    await publishAgentEvent(
      buildAgentEvent("audio_preprocessed", event.correlationId, {
        durationMs,
        mimeType: mimeType || "audio/webm",
        sizeBytes: normalizedBlob.size,
        sampleRateHint: undefined,
      }),
    );

    return Object.freeze({
      correlationId: event.correlationId,
      normalizedBlob,
      mimeType: mimeType || "audio/webm",
      sampleRateHint: 48_000,
      durationMs,
    });
  }

  const mimeType = canonicalMimeType(event.mimeType);
  if (!isAllowedMimeType(mimeType)) {
    throw new AudioFormatNotSupported(event.mimeType);
  }

  const decoded = await decodeToAudioBuffer(event.audioBlob);
  const monoSamples = await resampleToMono(decoded, TARGET_SAMPLE_RATE);

  const noiseProfile = computeNoiseProfile(monoSamples, SILENCE_THRESHOLD);
  const trimmed = trimSilence(monoSamples, SILENCE_THRESHOLD);
  const normalized = normalizePeakGain(trimmed, PEAK_TARGET, MAX_GAIN);

  const wavBuffer = encodeMonoPcmWav(normalized, TARGET_SAMPLE_RATE);
  const normalizedBlob = new Blob([wavBuffer], { type: OUTPUT_MIME_TYPE });
  const durationMs =
    normalized.length === 0
      ? 0
      : Math.round((normalized.length / TARGET_SAMPLE_RATE) * 1000);

  log.info(
    "audio preprocessed",
    {
      inputMime: mimeType,
      inputBytes: event.audioBlob.size,
      outputBytes: normalizedBlob.size,
      durationMs,
      sampleRate: TARGET_SAMPLE_RATE,
      rmsLevel: noiseProfile.rmsLevel,
      silenceRatio: noiseProfile.silenceRatio,
    },
    event.correlationId,
  );

  await publishAgentEvent(
    buildAgentEvent("audio_preprocessed", event.correlationId, {
      durationMs,
      mimeType: OUTPUT_MIME_TYPE,
      sizeBytes: normalizedBlob.size,
      sampleRateHint: TARGET_SAMPLE_RATE,
    }),
  );

  return Object.freeze({
    correlationId: event.correlationId,
    normalizedBlob,
    mimeType: OUTPUT_MIME_TYPE,
    sampleRateHint: TARGET_SAMPLE_RATE,
    durationMs,
    noiseProfile,
  });
}

// ------------------------------------------------------------------ //
// Internal helpers — all pure / deterministic given platform WebAudio.
// ------------------------------------------------------------------ //

function canonicalMimeType(raw: string): string {
  const head = (raw || "").split(";")[0];
  return head ? head.trim().toLowerCase() : "";
}

function isAllowedMimeType(mime: string): mime is (typeof ALLOWED_MIME_TYPES)[number] {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

interface AudioContextCtor {
  new (options?: AudioContextOptions): AudioContext;
}
interface OfflineAudioContextCtor {
  new (
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): OfflineAudioContext;
}

function getAudioContextCtor(): AudioContextCtor {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) {
    throw new AudioPreprocessingUnavailable("AudioContext not available in this context");
  }
  return Ctor;
}

function getOfflineAudioContextCtor(): OfflineAudioContextCtor {
  const g = globalThis as unknown as {
    OfflineAudioContext?: OfflineAudioContextCtor;
    webkitOfflineAudioContext?: OfflineAudioContextCtor;
  };
  const Ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctor) {
    throw new AudioPreprocessingUnavailable("OfflineAudioContext not available in this context");
  }
  return Ctor;
}

async function decodeToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const Ctx = getAudioContextCtor();
  const ctx = new Ctx();
  try {
    // decodeAudioData consumes (detaches) the ArrayBuffer; Blob.arrayBuffer()
    // returns a fresh one so we can hand it over directly.
    const buf = await blob.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } finally {
    if (typeof ctx.close === "function") {
      try {
        await ctx.close();
      } catch {
        // close() can reject if the context is already closed; non-fatal.
      }
    }
  }
}

async function resampleToMono(
  input: AudioBuffer,
  targetSampleRate: number,
): Promise<Float32Array> {
  const targetLength = Math.max(1, Math.ceil(input.duration * targetSampleRate));
  const OfflineCtx = getOfflineAudioContextCtor();
  const offline = new OfflineCtx(1, targetLength, targetSampleRate);

  const source = offline.createBufferSource();
  source.buffer = input;
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  // Single-channel destination ⇒ WebAudio performs standard downmix.
  return new Float32Array(rendered.getChannelData(0));
}

function computeNoiseProfile(
  samples: Float32Array,
  silenceThreshold: number,
): AudioNoiseProfile {
  if (samples.length === 0) {
    return { rmsLevel: 0, silenceRatio: 1 };
  }
  let sumSquares = 0;
  let silentCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSquares += s * s;
    if (Math.abs(s) < silenceThreshold) silentCount++;
  }
  const rmsLevel = Math.sqrt(sumSquares / samples.length);
  const silenceRatio = silentCount / samples.length;
  return { rmsLevel, silenceRatio };
}

function trimSilence(samples: Float32Array, silenceThreshold: number): Float32Array {
  if (samples.length === 0) return samples;
  let start = 0;
  let end = samples.length - 1;
  while (start <= end && Math.abs(samples[start]) < silenceThreshold) start++;
  while (end >= start && Math.abs(samples[end]) < silenceThreshold) end--;
  if (start > end) return new Float32Array(0);
  // Copy so downstream writers never mutate the decoded render buffer.
  return samples.slice(start, end + 1);
}

function normalizePeakGain(
  samples: Float32Array,
  peakTarget: number,
  maxGain: number,
): Float32Array {
  if (samples.length === 0) return samples;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) return samples;
  // Clamp gain so silent-but-not-zero input (pure noise floor) is not
  // amplified into ear-piercing output; this keeps the transform stable.
  const gain = Math.min(maxGain, peakTarget / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] * gain;
  }
  return out;
}

function encodeMonoPcmWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
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
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 =
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
