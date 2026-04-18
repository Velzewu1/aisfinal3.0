import type { PreprocessedAudioEvent } from "./preprocess.js";
import { buildAgentEvent, publishAgentEvent } from "../shared/agent-event-publish.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("voice.transcribe");

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_FILENAME = "audio.wav";

/**
 * Step 3 of the agent loop: pure perception — Speech-to-Text.
 *
 * Responsibility: turn a `PreprocessedAudioEvent` into a `TranscribedTextEvent`
 * by delegating transcription to an external STT API (Whisper or equivalent).
 *
 * Invariants:
 *   - Stateless async function. Output depends only on input + API response.
 *   - No DOM mutation, no `document.*`, no `window.*`. Network: STT `fetch` and
 *     `chrome.runtime.sendMessage` for perception `AgentEvent`s only.
 *   - No imports from `extension/controller/`, `extension/llm/`,
 *     `extension/background/`, or `extension/content/`.
 *   - No business logic: text is passed through verbatim.
 *   - Emits `speech_to_text_completed` and `text_transcribed` (observability).
 *   - No randomness, no branching on `correlationId`.
 */

export type TranscribedTextEvent = Readonly<{
  type: "transcribed_text";
  correlationId: string;
  timestamp: string;

  text: string;

  language?: string;
  confidence?: number;

  durationMs: number;
}>;

export interface TranscribeOptions {
  /** Override the STT endpoint (default: OpenAI `/v1/audio/transcriptions`). */
  readonly endpoint?: string;
  /** STT model identifier (default: `whisper-1`). */
  readonly model?: string;
  /** Bearer token for the STT provider. */
  readonly apiKey?: string;
  /** Optional ISO language hint passed to the provider (`en`, `ru`, `kk`, ...). */
  readonly language?: string;
  /** Caller-controlled cancellation. */
  readonly signal?: AbortSignal;
  /** Fetch implementation override (keeps the module testable / stateless). */
  readonly fetchImpl?: typeof fetch;
}

interface WhisperJsonResponse {
  readonly text?: unknown;
  readonly language?: unknown;
}

export async function transcribeAudio(
  input: PreprocessedAudioEvent,
  options: TranscribeOptions = {},
): Promise<TranscribedTextEvent> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const audioBlob = input.normalizedBlob;
  const form = new FormData();
  // Step 2's `PreprocessedAudioEvent` carries the audio as `normalizedBlob`
  // (the Step-3 prompt's informal `audioBlob` label refers to the same field).
  form.append("file", audioBlob, DEFAULT_FILENAME);
  form.append("model", model);
  form.append("response_format", "json");
  if (options.language) {
    form.append("language", options.language);
  }

  const headers: Record<string, string> = {};
  if (options.apiKey) {
    headers["authorization"] = `Bearer ${options.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      body: form,
      headers,
      signal: options.signal,
    });
  } catch (err: unknown) {
    log.error("stt network failure", String(err), input.correlationId);
    throw new Error("stt_failed");
  }

  if (!response.ok) {
    log.error(
      "stt http error",
      { status: response.status, statusText: response.statusText },
      input.correlationId,
    );
    throw new Error("stt_failed");
  }

  let payload: WhisperJsonResponse;
  try {
    payload = (await response.json()) as WhisperJsonResponse;
  } catch (err: unknown) {
    log.error("stt response parse failed", String(err), input.correlationId);
    throw new Error("stt_failed");
  }

  const text = typeof payload.text === "string" ? payload.text : "";
  // TEMP: debug STT in service worker DevTools — remove when done
  console.log("whisper result:", text);
  if (text.trim().length === 0) {
    log.warn("empty transcription", undefined, input.correlationId);
    throw new Error("empty_transcription");
  }

  const language =
    typeof payload.language === "string" && payload.language.length > 0
      ? payload.language
      : undefined;

  const event: TranscribedTextEvent = Object.freeze({
    type: "transcribed_text",
    correlationId: input.correlationId,
    timestamp: new Date().toISOString(),
    text,
    language,
    durationMs: input.durationMs,
  });

  log.info(
    "transcription_received",
    {
      chars: text.length,
      language: language ?? null,
      durationMs: input.durationMs,
    },
    input.correlationId,
  );

  const sttPayload = {
    chars: text.length,
    durationMs: input.durationMs,
    ...(language !== undefined ? { language } : {}),
  };
  await publishAgentEvent(buildAgentEvent("speech_to_text_completed", input.correlationId, sttPayload));
  await publishAgentEvent(buildAgentEvent("text_transcribed", input.correlationId, sttPayload));

  return event;
}
