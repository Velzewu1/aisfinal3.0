import type { IntentKind } from "@ai-rpa/schemas";

/**
 * Step 10 — proactivity *hints* (behavior layer, NOT a pipeline step).
 *
 * Pure suggestion mapping. Consumed by UI surfaces (sidepanel) to nudge the
 * doctor toward the next logical clinical step after an executed action.
 *
 * Invariants:
 *   - No DOM, no `chrome.*`, no backend, no event emission from this module.
 *   - No execution side effects. These are *hints*, not actions.
 *   - Never bypasses the controller decision gate; sidepanel uses these
 *     only for display text and still routes any user acceptance through
 *     the normal `user_utterance` / `auto_schedule` pipeline where applicable.
 *   - `ProactiveSuggestion` is a local UI-only token, never persisted as an `AgentEvent`.
 *
 * Primary exam schedule nudge: only after {@link EXAM_COMPLETE_FIELDS} have all
 * been filled at least once this session (see {@link afterPrimaryExamFillExecuted}).
 */

export type ProactiveSuggestion =
  | "suggest_schedule"
  | "suggest_exam_progress"
  | "suggest_next_form"
  | "suggest_finish_visit";

/** Key primary-exam fields that must be filled before offering CP-SAT scheduling. */
export const EXAM_COMPLETE_FIELDS: readonly string[] = Object.freeze([
  "complaints_on_admission",
  "objective_findings",
  "diagnosis",
]);

const filledFields = new Set<string>();

let lastPatientSig = "";
let lastPage: string | null = null;

function patientSig(p: { patientId?: string; patientName?: string }): string {
  return `${p.patientId ?? ""}\u0000${p.patientName ?? ""}`;
}

/**
 * Call on each `context_attached` event. Clears {@link filledFields} when the
 * patient changes or when the active page leaves `primary_exam`.
 */
export function onContextAttachedForExamProgress(payload: {
  readonly currentPage: string;
  readonly patientId?: string;
  readonly patientName?: string;
}): void {
  const sig = patientSig(payload);
  if (lastPatientSig !== "" && sig !== lastPatientSig) {
    filledFields.clear();
  }
  if (lastPage === "primary_exam" && payload.currentPage !== "primary_exam") {
    filledFields.clear();
  }
  lastPatientSig = sig;
  lastPage = payload.currentPage;
}

/** Reset exam fill tracking when an agent-driven navigation intent executes. */
export function clearPrimaryExamFillProgressOnAgentNavigate(): void {
  filledFields.clear();
}

export type PrimaryExamFillHint =
  | { readonly kind: "none" }
  | { readonly kind: "schedule"; readonly suggestion: "suggest_schedule" }
  | {
      readonly kind: "progress";
      readonly suggestion: "suggest_exam_progress";
      readonly displayMessage: string;
    };

/**
 * After a successful **fill** execute on the active page: record slot fields and
 * return whether to show the schedule suggestion or an in-progress nudge.
 *
 * Progress nudge is shown only when at least two of {@link EXAM_COMPLETE_FIELDS}
 * are filled but not all three (avoids nagging after a single key field).
 */
export function afterPrimaryExamFillExecuted(
  slots: readonly { readonly field: string }[],
  currentPage: string,
): PrimaryExamFillHint {
  if (currentPage !== "primary_exam") {
    return { kind: "none" };
  }

  for (const s of slots) {
    filledFields.add(s.field);
  }

  const keyFilledCount = EXAM_COMPLETE_FIELDS.filter((f) => filledFields.has(f)).length;

  if (keyFilledCount >= EXAM_COMPLETE_FIELDS.length) {
    return { kind: "schedule", suggestion: "suggest_schedule" };
  }

  if (keyFilledCount >= 2 && keyFilledCount < EXAM_COMPLETE_FIELDS.length) {
    return {
      kind: "progress",
      suggestion: "suggest_exam_progress",
      displayMessage: `Заполнено ${keyFilledCount} из ${EXAM_COMPLETE_FIELDS.length} ключевых полей. Продолжайте осмотр.`,
    };
  }

  return { kind: "none" };
}

/**
 * Post-execution hint mapping for intents that are not handled by
 * {@link afterPrimaryExamFillExecuted}.
 */
export function suggestNext(intentKind: IntentKind): ProactiveSuggestion | null {
  switch (intentKind) {
    case "fill":
      return null;
    case "schedule":
      return "suggest_finish_visit";
    case "navigate":
      return "suggest_next_form";
    case "set_status":
    case "unknown":
      return null;
    default: {
      const _exhaustive: never = intentKind;
      void _exhaustive;
      return null;
    }
  }
}

export const SUGGESTION_TEXT: Readonly<Record<ProactiveSuggestion, string>> = Object.freeze({
  suggest_schedule:
    "Основные поля осмотра заполнены (жалобы, объективный статус, диагноз). Сформировать расписание процедур на 9 рабочих дней?",
  suggest_exam_progress: "",
  suggest_next_form: "Форма открыта. Заполнить по голосу?",
  suggest_finish_visit: "Расписание готово. Завершить визит?",
});
