import type { IntentKind } from "@ai-rpa/schemas";

/**
 * Step 10 — proactivity *hints* (behavior layer, NOT a pipeline step).
 *
 * Pure suggestion mapping. Consumed by UI surfaces (sidepanel) to nudge the
 * doctor toward the next logical clinical step after an executed action.
 *
 * Invariants:
 *   - Pure. No DOM, no `chrome.*`, no backend, no event emission.
 *   - No execution side effects. These are *hints*, not actions.
 *   - Never bypasses the controller decision gate; sidepanel uses these
 *     only for display text and still routes any user acceptance through
 *     the normal `user_utterance` pipeline.
 *   - No schema changes — `ProactiveSuggestion` is a local UI-only token,
 *     never persisted as an `AgentEvent`.
 */

export type ProactiveSuggestion =
  | "suggest_schedule"
  | "suggest_next_form"
  | "suggest_finish_visit";

/**
 * Post-execution hint mapping.
 *
 *   fill      → schedule the rehab programme next
 *   schedule  → wrap up the current visit (next patient flow)
 *   navigate  → the doctor likely wants to fill the opened form
 *   other     → no hint
 */
export function suggestNext(intentKind: IntentKind): ProactiveSuggestion | null {
  switch (intentKind) {
    case "fill":
      return "suggest_schedule";
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
  suggest_schedule: "Осмотр заполнен. Сформировать расписание?",
  suggest_next_form: "Форма открыта. Заполнить по голосу?",
  suggest_finish_visit: "Расписание готово. Завершить визит?",
});
