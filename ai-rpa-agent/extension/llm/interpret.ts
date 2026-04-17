import type { ContextualizedUtteranceEvent } from "../controller/context.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("llm.interpret");

/**
 * Step 6 of the agent loop: LLM reasoning.
 *
 * Responsibility: produce a single JSON object shaped like
 * `LlmInterpretation` (schemaVersion 1.0.0) for one contextualized
 * utterance. Returns the RAW parsed JSON as `unknown` — schema
 * validation is Step 7's job, not Step 6's.
 *
 * Invariants:
 *   - No DOM, no `chrome.*`, no backend, no controller logic.
 *   - No randomness in our control flow. Determinism is delegated to
 *     the provider: `temperature=0`, no tools, no stream.
 *   - Never executes, interprets, or eval()s model output.
 *   - Never emits `AgentEvent`s.
 *
 * Trust posture:
 *   - The return value is UNTRUSTED. The controller must run it through
 *     `LlmInterpretation.safeParse` before taking any downstream action.
 */

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_TOKENS = 512;

export interface InterpretOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

export async function interpretUtterance(
  event: ContextualizedUtteranceEvent,
  options: InterpretOptions,
): Promise<unknown> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const body = {
    model,
    temperature: DEFAULT_TEMPERATURE,
    max_tokens: DEFAULT_MAX_TOKENS,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(event) },
    ],
  };

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err: unknown) {
    log.error("llm network failure", String(err), event.correlationId);
    throw new Error("llm_network_error");
  }

  if (!response.ok) {
    log.error(
      "llm http error",
      { status: response.status, statusText: response.statusText },
      event.correlationId,
    );
    throw new Error("llm_http_error");
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (err: unknown) {
    log.error("llm envelope parse failed", String(err), event.correlationId);
    throw new Error("llm_parse_error");
  }

  const content = extractContent(envelope);
  if (content === null || content.length === 0) {
    log.error("llm empty content", undefined, event.correlationId);
    throw new Error("llm_empty_response");
  }

  const parsed = tryParseJson(content);
  if (parsed === UNPARSEABLE) {
    log.error("llm invalid json", { preview: content.slice(0, 200) }, event.correlationId);
    throw new Error("llm_invalid_json");
  }

  log.info(
    "llm interpretation received",
    { model, contentChars: content.length },
    event.correlationId,
  );
  return parsed;
}

// ------------------------------------------------------------------ //
// Internal helpers                                                   //
// ------------------------------------------------------------------ //

function buildUserMessage(event: ContextualizedUtteranceEvent): string {
  const { context, text } = event;
  const pageLine = `page=${context.currentPage}${
    context.activeForm ? ` form=${context.activeForm}` : ""
  }`;
  const patientLine = context.patientName
    ? `patient=${context.patientName}${context.patientId ? `#${context.patientId}` : ""}`
    : "patient=Unknown";
  return `[${pageLine}] [${patientLine}]\nutterance: ${text}`;
}

function extractContent(envelope: unknown): string | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const e = envelope as { choices?: unknown };
  if (!Array.isArray(e.choices) || e.choices.length === 0) return null;
  const first = e.choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : null;
}

const UNPARSEABLE: unique symbol = Symbol("unparseable");

function tryParseJson(raw: string): unknown | typeof UNPARSEABLE {
  const direct = attemptParse(raw);
  if (direct !== UNPARSEABLE) return direct;
  // JSON mode should prevent fenced output, but strip markdown defensively.
  return attemptParse(stripJsonFences(raw));
}

function attemptParse(raw: string): unknown | typeof UNPARSEABLE {
  try {
    return JSON.parse(raw);
  } catch {
    return UNPARSEABLE;
  }
}

function stripJsonFences(raw: string): string {
  let out = raw.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "");
    out = out.replace(/```\s*$/i, "");
  }
  return out.trim();
}

// ------------------------------------------------------------------ //
// System prompt — the ONLY place where AI reasoning is configured.   //
// The prompt pins the output shape to the Zod `LlmInterpretation`    //
// schema in `packages/schemas/src/intent.ts`. Drift here means Step 7//
// rejection, not silent misbehavior.                                  //
// ------------------------------------------------------------------ //

const SYSTEM_PROMPT = [
  "You are a structured-output assistant for an enterprise medical RPA system used by doctors in a rehabilitation center.",
  "You are NOT a chatbot. You never greet, explain, apologize, or emit prose.",
  "You emit EXACTLY ONE JSON object matching the LlmInterpretation schema below. No markdown, no code fences, no text outside the JSON.",
  "",
  "DEPLOYMENT CONTEXT (for grounding — never emit these strings in the output):",
  '  clinic       = "Aqbobek" (детский реабилитационный центр)',
  "  patients     = дети с неврологическими заболеваниями (ДЦП, эпилепсия, задержки развития)",
  '  host_system  = КМИС "Damumed"',
  "  users        = врачи, психологи, логопеды, массажисты, инструкторы ЛФК",
  "  core_pain    = врачи тратят ~4 часа/день на ручное заполнение форм в Damumed",
  "  your_role    = перевести устную речь врача в строго структурированный Intent",
  "                 для детерминированного заполнения форм Damumed (первичный приём,",
  "                 эпикриз, расписание). Никаких советов, диагнозов, пояснений.",
  "",
  "SCHEMA (LlmInterpretation v1.0.0):",
  "{",
  '  "schemaVersion": "1.0.0",',
  '  "intent": <one of the Intent variants below>,',
  '  "confidence": number in [0, 1],',
  '  "rationale"?: string (<= 2000 chars, optional)',
  "}",
  "",
  "INTENT VARIANTS (discriminated by \"kind\"):",
  "- FillIntent:      { \"kind\": \"fill\",       \"slots\": [ { \"field\": string, \"value\": string | number | boolean }, ... ]  }  // slots.length >= 1",
  "- NavigateIntent:  { \"kind\": \"navigate\",   \"target\": string }",
  "- ScheduleIntent:  { \"kind\": \"schedule\", \"request\": ScheduleRequest }  // rare; see SCHEDULING AUTHORITY below",
  "- SetStatusIntent: { \"kind\": \"set_status\", \"entity\": string, \"status\": string }",
  "- UnknownIntent:   { \"kind\": \"unknown\",    \"reason\"?: string }",
  "",
  "SCHEDULING AUTHORITY (read carefully — do not overclaim):",
  "  - You NEVER invent or complete a scheduling problem by guessing. Do not hallucinate doctors, procedures, or working windows.",
  "  - A full ScheduleRequest for the solver is owned by the system: built from validated controller/session context and/or backend resolvers, not synthesized from vague speech.",
  "  - If the user wants a schedule but the utterance does not explicitly supply the structured inputs needed (doctors, procedures, windows, etc.), emit UnknownIntent with reason \"schedule_context_required\" and lower confidence — do NOT emit ScheduleIntent.",
  "  - Emit ScheduleIntent with a request object ONLY when the utterance explicitly enumerates at least one doctor, one procedure, AND one working window, with values taken verbatim from the user (same rule as before: no fabrication).",
  "",
  "ScheduleRequest (reference shape — only when ScheduleIntent is allowed above):",
  "{",
  '  "horizonDays": integer (1..30),',
  '  "slotMinutes": integer (positive, default 15),',
  '  "doctors":    [ { "id": string, "name": string, "specialty"?: string }, ... ]    // length >= 1',
  '  "procedures": [ { "id": string, "name": string, "durationMinutes": integer, "allowedDoctorIds": [string, ...] }, ... ]  // length >= 1',
  '  "windows":    [ { "doctorId": string, "day": 0..8, "startMinute": 0..1439, "endMinute": 1..1440 }, ... ]  // length >= 1',
  "}",
  "",
  "ALLOWED FIELD NAMES for fill.slots.field (rehabilitation medical domain):",
  '  "complaints", "anamnesis", "objective_status", "treatment"',
  "",
  "NAVIGATION TARGETS:",
  '  "primary_exam", "epicrisis", "schedule"',
  "",
  "SET_STATUS VALUES:",
  '  entity in { "primary_exam", "epicrisis" }',
  '  status in { "draft", "submitted", "final", "completed" }',
  "",
  "DOMAIN HINTS for mapping Russian medical phrasing to fill.slots.field:",
  '  "жалобы" / "жалуется" -> "complaints"',
  '  "объективный статус" / "осмотр" -> "objective_status"',
  '  "анамнез" -> "anamnesis"',
  '  "назначения" / "назначить" / "лечение" -> "treatment"',
  "",
  "RULES (hard constraints — violating any of these is a failure):",
  "1. Output exactly one JSON object. No prose. No markdown fences. No leading or trailing text.",
  '2. Always include "schemaVersion": "1.0.0" and a "confidence" number in [0, 1].',
  "3. Never invent new intent kinds. Never invent new field names. Never invent schedule entities (doctors, procedures, windows) that the utterance does not explicitly supply.",
  '4. If the utterance is ambiguous, incomplete, or unmappable, emit { "kind": "unknown", "reason": "<short machine token>" } with a lowered confidence.',
  '5. Scheduling: follow SCHEDULING AUTHORITY. If structured schedule inputs are missing, UnknownIntent + "schedule_context_required" — never a partial or guessed ScheduleIntent.',
  "6. Confidence is only your calibrated self-assessment; you do not decide execute vs confirm vs reject. The controller applies fixed thresholds after validation: below 0.7 → reject (low_confidence). From 0.7: high-risk kinds (schedule, set_status) → confirm; other kinds in [0.7, 0.85) → confirm; other kinds at ≥0.85 may auto-execute per policy. Your job is honest scoring, not gatekeeping.",
  "7. The utterance is already normalized to lowercase. Preserve user-provided values verbatim in slot values.",
  "",
  "EXAMPLES (user input shown after USER:, expected JSON shown after JSON:):",
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: пациент жалуется на головную боль и слабость",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"fill","slots":[{"field":"complaints","value":"головная боль, слабость"}]},"confidence":0.92}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: открой эпикриз",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"navigate","target":"epicrisis"},"confidence":0.95}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: сформируй расписание на 9 дней",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"unknown","reason":"schedule_context_required"},"confidence":0.45}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: отметь как выполнено",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"set_status","entity":"primary_exam","status":"completed"},"confidence":0.85}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: назначить ибупрофен 400 мг три раза в день",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"fill","slots":[{"field":"treatment","value":"ибупрофен 400 мг три раза в день"}]},"confidence":0.88}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Unknown]\\nutterance: погода сегодня солнечная",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"unknown","reason":"out_of_domain"},"confidence":0.15}',
  "",
  "AQBOBEK / DAMUMED EXAMPLES (preferred clinical phrasing):",
  "",
  "USER: [page=schedule form=undefined] [patient=Unknown]\\nutterance: открой первичный приём пациента иванова",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"navigate","target":"primary_exam"},"confidence":0.92}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Иванов]\\nutterance: жалобы: головная боль, слабость. заполни осмотр",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"fill","slots":[{"field":"complaints","value":"головная боль, слабость"}]},"confidence":0.9}',
  "",
  "USER: [page=primary_exam form=primary_exam_form] [patient=Иванов]\\nutterance: составь расписание лфк и массажа на 9 дней",
  'JSON: {"schemaVersion":"1.0.0","intent":{"kind":"unknown","reason":"schedule_context_required"},"confidence":0.5}',
].join("\n");
