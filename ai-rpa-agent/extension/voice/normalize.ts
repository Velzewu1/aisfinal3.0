import type { TranscribedTextEvent } from "./transcribe.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("voice.normalize");

/**
 * Step 4 of the agent loop: deterministic utterance normalization.
 *
 * Responsibility: turn a `TranscribedTextEvent` into a
 * `NormalizedUtteranceEvent` by applying a small, fixed set of text
 * transforms.
 *
 * Invariants:
 *   - Pure synchronous function. Output depends only on input.
 *   - No LLM, no network, no `chrome.*`, no `document.*`, no `window.*`.
 *   - No imports from `extension/controller/`, `extension/llm/`,
 *     `extension/background/`, `extension/content/`, or `packages/schemas/`.
 *   - No randomness, no clock-driven logic (only the output `timestamp`
 *     field reads `Date.now()`, which does not affect any branching).
 *   - No semantic interpretation: keyword hints are simple substring flags,
 *     not an intent classifier.
 */

const FILLER_WORDS = ["эээ", "ну", "короче", "типа", "как бы"] as const;

const MULTI_WORD_FILLERS: readonly string[] = FILLER_WORDS.filter((w) => w.includes(" "));
const SINGLE_WORD_FILLERS: ReadonlySet<string> = new Set(
  FILLER_WORDS.filter((w) => !w.includes(" ")),
);

// Order matters: entities appear in `possibleEntities` in rule-declaration order
// so identical inputs always produce identical arrays.
const HINT_RULES: ReadonlyArray<{ readonly substr: string; readonly entity: string }> = [
  { substr: "жалоб", entity: "complaints" },
  { substr: "боль", entity: "symptoms" },
  { substr: "назнач", entity: "treatment" },
];

export type NormalizedUtteranceEvent = Readonly<{
  type: "utterance_normalized";
  correlationId: string;
  timestamp: string;

  rawText: string;
  normalizedText: string;

  hints?: {
    possibleEntities?: string[];
    detectedLanguage?: string;
  };

  durationMs: number;
}>;

export function normalizeUtterance(input: TranscribedTextEvent): NormalizedUtteranceEvent {
  const rawText = input.text;
  if (rawText.trim().length === 0) {
    throw new Error("empty_utterance");
  }

  const normalizedText = normalizeText(rawText);
  if (normalizedText.length === 0) {
    throw new Error("empty_utterance");
  }

  const possibleEntities = detectEntities(normalizedText);
  const detectedLanguage =
    typeof input.language === "string" && input.language.length > 0 ? input.language : undefined;

  const hasEntities = possibleEntities.length > 0;
  const hints: NormalizedUtteranceEvent["hints"] =
    hasEntities || detectedLanguage !== undefined
      ? {
          ...(hasEntities ? { possibleEntities } : {}),
          ...(detectedLanguage ? { detectedLanguage } : {}),
        }
      : undefined;

  const event: NormalizedUtteranceEvent = Object.freeze({
    type: "utterance_normalized",
    correlationId: input.correlationId,
    timestamp: new Date().toISOString(),
    rawText,
    normalizedText,
    hints,
    durationMs: input.durationMs,
  });

  log.info(
    "utterance normalized",
    {
      rawChars: rawText.length,
      normChars: normalizedText.length,
      entities: possibleEntities,
      detectedLanguage: detectedLanguage ?? null,
    },
    input.correlationId,
  );
  return event;
}

// ------------------------------------------------------------------ //
// Internal helpers — pure, deterministic, no external dependencies.  //
// ------------------------------------------------------------------ //

function normalizeText(raw: string): string {
  let text = raw.toLowerCase();

  // Step: collapse all whitespace (tabs, newlines, multiple spaces) to a single space.
  text = text.replace(/\s+/g, " ").trim();

  // Step: remove multi-word fillers as whole phrases, bounded by whitespace/edges
  // (Cyrillic-safe — does not rely on \b which mis-handles non-ASCII).
  for (const phrase of MULTI_WORD_FILLERS) {
    const escaped = escapeRegExp(phrase);
    text = text.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), "$1");
  }
  text = text.replace(/\s+/g, " ").trim();

  // Step: tokenize; drop single-word fillers; collapse adjacent duplicate tokens.
  const tokens = text.split(" ").filter((t) => t.length > 0 && !SINGLE_WORD_FILLERS.has(t));
  const dedup: string[] = [];
  for (const t of tokens) {
    if (dedup.length === 0 || dedup[dedup.length - 1] !== t) {
      dedup.push(t);
    }
  }
  return dedup.join(" ");
}

function detectEntities(normalized: string): string[] {
  const out: string[] = [];
  for (const rule of HINT_RULES) {
    if (normalized.includes(rule.substr) && !out.includes(rule.entity)) {
      out.push(rule.entity);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
