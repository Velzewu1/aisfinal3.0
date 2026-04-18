import type { DomAction, ExecutorResult, InjectScheduleSlot, ScheduleInjectPayload } from "@ai-rpa/schemas";
import { selectByDataAttr } from "./selectors.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("executor");

type SpecialistKind = "lfk" | "massage" | "psychologist" | "speech" | "default";

interface ParsedSlotTime {
  readonly day: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Deterministic mapping from doctor/procedure identifiers to visual specialist
 * buckets used by the mock UI stylesheet. The mapping is keyword-based — the
 * planner and backend are free to use any `doctorId` scheme; the executor only
 * derives a presentational class. This is NOT medical classification; it is a
 * UI render hint and never feeds decisions.
 */
const SPECIALIST_KIND_PATTERNS: ReadonlyArray<readonly [RegExp, SpecialistKind]> = [
  [/(лфк|exercise[_-]?therapy|lfk|kineso|kinezo)/i, "lfk"],
  [/(массаж|massage)/i, "massage"],
  [/(психолог|psycholog|psychologist)/i, "psychologist"],
  [/(логопед|speech|logoped)/i, "speech"],
];

function resolveSpecialistKind(doctorId: string, procedureId: string): SpecialistKind {
  const probe = `${doctorId} ${procedureId}`;
  for (const [pattern, kind] of SPECIALIST_KIND_PATTERNS) {
    if (pattern.test(probe)) return kind;
  }
  return "default";
}

function parseSlotTime(raw: string): ParsedSlotTime | null {
  const match = /^\s*(-?\d+)\s*:\s*(\d+)\s*-\s*(\d+)\s*$/.exec(raw);
  if (!match) return null;
  const day = Number(match[1]);
  const startMinute = Number(match[2]);
  const endMinute = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return null;
  }
  return { day, startMinute, endMinute };
}

function formatClock(minuteOfDay: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minuteOfDay)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Presentational label derived from a validated `procedureId`. The executor
 * cannot invent procedure names; it only cleans up identifier punctuation so
 * the mock UI renders something readable when the planner did not attach a
 * richer display label. The LLM is never consulted.
 */
function humanizeProcedureId(procedureId: string): string {
  const stripped = procedureId.replace(/^(proc|procedure)[_-]/i, "");
  const spaced = stripped.replace(/[_-]+/g, " ").trim();
  if (spaced.length === 0) return procedureId;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function findScheduleCell(host: HTMLElement, day: number, doctorId: string): HTMLElement | null {
  const byExact = host.querySelector<HTMLElement>(
    `[data-schedule-cell][data-day="${CSS.escape(String(day))}"][data-specialist="${CSS.escape(doctorId)}"]`,
  );
  return byExact;
}

function renderScheduleSlot(host: HTMLElement, slot: InjectScheduleSlot): boolean {
  const parsed = parseSlotTime(slot.time);
  if (!parsed) return false;
  const uiDay = parsed.day >= 0 ? parsed.day + 1 : parsed.day;
  const cell = findScheduleCell(host, uiDay, slot.doctorId);
  if (!cell) return false;

  const kind = resolveSpecialistKind(slot.doctorId, slot.procedureId);
  const label = humanizeProcedureId(slot.procedureId);
  const startLabel = formatClock(parsed.startMinute);
  const endLabel = formatClock(parsed.endMinute);

  cell.setAttribute("data-filled", "true");
  cell.setAttribute("data-specialist-kind", kind);

  const slotContainer = document.createElement("div");
  slotContainer.className = "slot";

  const timeEl = document.createElement("span");
  timeEl.className = "time";
  timeEl.textContent = `${startLabel}–${endLabel}`;

  const procEl = document.createElement("span");
  procEl.className = "proc";
  procEl.textContent = label;

  slotContainer.append(timeEl, procEl);
  cell.replaceChildren(slotContainer);
  return true;
}

function resetScheduleGrid(host: HTMLElement): void {
  const emptyLabel = host.getAttribute("data-schedule-empty-label") ?? "Свободно";
  const cells = host.querySelectorAll<HTMLElement>("[data-schedule-cell]");
  cells.forEach((cell) => {
    cell.setAttribute("data-filled", "false");
    cell.setAttribute("data-specialist-kind", cell.getAttribute("data-specialist-kind-default") ?? cell.getAttribute("data-specialist-kind") ?? "default");
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.textContent = emptyLabel;
    cell.replaceChildren(slot);
  });
}

function renderSchedulePayload(host: HTMLElement, payload: ScheduleInjectPayload): {
  rendered: number;
  dropped: number;
} {
  // Preserve the initial kind so a re-render can reset the tint.
  host.querySelectorAll<HTMLElement>("[data-schedule-cell]").forEach((cell) => {
    if (!cell.hasAttribute("data-specialist-kind-default")) {
      cell.setAttribute(
        "data-specialist-kind-default",
        cell.getAttribute("data-specialist-kind") ?? "default",
      );
    }
  });
  resetScheduleGrid(host);

  let rendered = 0;
  let dropped = 0;
  for (const slot of payload.slots) {
    if (renderScheduleSlot(host, slot)) rendered += 1;
    else dropped += 1;
  }
  host.setAttribute("data-schedule-rendered", String(rendered));
  host.setAttribute("data-schedule-dropped", String(dropped));
  return { rendered, dropped };
}

/**
 * Deterministic RPA executor.
 *
 * - Accepts only validated `DomAction` objects.
 * - Uses ONLY approved `data-*` selectors.
 * - Never interprets natural language, never calls the LLM, never runs `eval`.
 * - Never injects HTML from untrusted sources.
 */
export const executor = {
  async run(actions: DomAction[], correlationId: string): Promise<ExecutorResult> {
    const executed: DomAction[] = [];
    const failed: ExecutorResult["failed"] = [];

    for (const action of actions) {
      try {
        await dispatch(action);
        executed.push(action);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("action failed", { kind: action.kind, message }, correlationId);
        failed.push({ action, error: message });
      }
    }

    return {
      correlationId,
      ok: failed.length === 0,
      executed,
      failed,
    };
  },
};

async function dispatch(action: DomAction): Promise<void> {
  switch (action.kind) {
    case "fill": {
      const el = selectByDataAttr("data-field", action.field);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        throw new Error(`dom_target_missing: data-field="${action.field}"`);
      }
      el.value = String(action.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    case "click": {
      const el = selectByDataAttr("data-action", action.action);
      if (!(el instanceof HTMLElement)) {
        throw new Error(`dom_target_missing: data-action="${action.action}"`);
      }
      el.click();
      return;
    }

    case "navigate": {
      const el = selectByDataAttr("data-nav", action.nav);
      if (!(el instanceof HTMLElement)) {
        throw new Error(`dom_target_missing: data-nav="${action.nav}"`);
      }
      el.click();
      return;
    }

    case "set_status": {
      const el = selectByDataAttr("data-status-entity", action.entity);
      if (!(el instanceof HTMLElement)) {
        throw new Error(`dom_target_missing: data-status-entity="${action.entity}"`);
      }
      el.setAttribute("data-status", action.status);
      el.dispatchEvent(new CustomEvent("status-changed", { bubbles: true, detail: { status: action.status } }));
      return;
    }

    case "inject_schedule": {
      const host = selectByDataAttr("data-schedule-grid", action.grid);
      if (!(host instanceof HTMLElement)) {
        throw new Error(`dom_target_missing: data-schedule-grid="${action.grid}"`);
      }
      host.setAttribute("data-schedule-payload", JSON.stringify(action.payload));
      const { rendered, dropped } = renderSchedulePayload(host, action.payload);
      host.dispatchEvent(
        new CustomEvent("schedule-injected", {
          bubbles: true,
          detail: { payload: action.payload, rendered, dropped },
        }),
      );
      return;
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      throw new Error("unknown_action");
    }
  }
}
