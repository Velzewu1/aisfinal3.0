import type { DomAction, ExecutorResult, ScheduleInjectPayload } from "@ai-rpa/schemas";
import { publishScheduleBridgeToPage, schedulePayloadToBridgeState } from "./schedule-bridge.js";
import { selectByDataAttr } from "./selectors.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("executor");

interface ParsedSlotTime {
  readonly day: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Schedule day convention (9-day mock grid):
 * - Internal / backend / slot string: `day` ∈ 0..8 (horizon index; column "День 1" → 0).
 * - DOM: `data-day-index` = internal day; `data-day` = internal day + 1 (1..9).
 */
function uiDataDayFromInternalDay(internalDay: number): number {
  return internalDay >= 0 ? internalDay + 1 : internalDay;
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

/** @param uiDataDay `data-day` (1..9), i.e. internalDay + 1 */
function findScheduleCell(host: HTMLElement, uiDataDay: number, doctorId: string): HTMLElement | null {
  const byExact = host.querySelector<HTMLElement>(
    `[data-schedule-cell][data-day="${CSS.escape(String(uiDataDay))}"][data-specialist="${CSS.escape(doctorId)}"]`,
  );
  return byExact;
}

/**
 * Counts how many slots map to real grid cells. Visual schedule cells are
 * painted by the mock page (`schedule-renderer.js`) from `window.__SCHEDULE_STATE__`
 * after {@link publishScheduleBridgeToPage}; the executor only clears the grid
 * and publishes validated state.
 */
function measureScheduleSlots(host: HTMLElement, payload: ScheduleInjectPayload): {
  rendered: number;
  dropped: number;
} {
  let rendered = 0;
  let dropped = 0;
  for (const slot of payload.slots) {
    const parsed = parseSlotTime(slot.time);
    if (!parsed) {
      dropped += 1;
      continue;
    }
    const uiDataDay = uiDataDayFromInternalDay(parsed.day);
    const cell = findScheduleCell(host, uiDataDay, slot.doctorId);
    if (cell) rendered += 1;
    else dropped += 1;
  }
  return { rendered, dropped };
}

/** Diary mock-ui procedure entities (`mock-ui/diary.html`) — richer UX on `completed`. */
const DIARY_SERVICE_ENTITIES: ReadonlySet<string> = new Set([
  "lfk",
  "massage",
  "psychologist",
  "speech_therapy",
]);

function formatLocalHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function applyDiaryServiceCompleted(entity: string, statusEl: HTMLElement, at: Date): void {
  const hhmm = formatLocalHm(at);
  statusEl.textContent = `Выполнено ✓ ${hhmm}`;
  statusEl.style.backgroundColor = "#e8f5e9";
  statusEl.style.color = "#1b5e20";
  const card = statusEl.closest(".procedure-card");
  if (card instanceof HTMLElement) {
    card.setAttribute("data-status", "completed");
    card.style.backgroundColor = "#e8f5e9";
  }

  const fieldName = `service_result_${entity}`;
  const ta = selectByDataAttr("data-field", fieldName);
  if (ta instanceof HTMLTextAreaElement) {
    const current = ta.value.trim();
    if (current.length === 0) {
      ta.value = `Выполнено. ${hhmm}`;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

function resetScheduleGrid(host: HTMLElement): void {
  const emptyLabel = host.getAttribute("data-schedule-empty-label") ?? "Свободно";
  const cells = host.querySelectorAll<HTMLElement>("[data-schedule-cell]");
  cells.forEach((cell) => {
    cell.setAttribute("data-filled", "false");
    cell.setAttribute("data-specialist-kind", cell.getAttribute("data-specialist-kind-default") ?? cell.getAttribute("data-specialist-kind") ?? "default");
    const slot = document.createElement("div");
    slot.className = "slot slot--empty";
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

  const { rendered, dropped } = measureScheduleSlots(host, payload);
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
      const at = new Date();
      if (action.status === "completed" && DIARY_SERVICE_ENTITIES.has(action.entity)) {
        applyDiaryServiceCompleted(action.entity, el, at);
      }
      el.dispatchEvent(
        new CustomEvent("status-changed", {
          bubbles: true,
          detail: { status: action.status, completedAtIso: at.toISOString() },
        }),
      );
      return;
    }

    case "inject_schedule": {
      const slotCount = Array.isArray(action.payload?.slots) ? action.payload.slots.length : 0;
      log.info("inject_schedule: querying grid", {
        grid: action.grid,
        selector: `[data-schedule-grid="${action.grid}"]`,
        slotCount,
        url: typeof window !== "undefined" ? window.location?.href : null,
      });

      const host = selectByDataAttr("data-schedule-grid", action.grid);
      if (!(host instanceof HTMLElement)) {
        log.error("inject_schedule: target element not found", {
          grid: action.grid,
          selector: `[data-schedule-grid="${action.grid}"]`,
          url: typeof window !== "undefined" ? window.location?.href : null,
        });
        throw new Error(`dom_target_missing: data-schedule-grid="${action.grid}"`);
      }

      log.info("inject_schedule: element found, payload", {
        grid: action.grid,
        payload: action.payload,
      });

      const payloadJson = JSON.stringify(action.payload);
      // Drop then set so MutationObserver always sees a change (identical JSON string would otherwise skip mutations in some engines).
      host.removeAttribute("data-schedule-payload");
      host.setAttribute("data-schedule-payload", payloadJson);
      const { rendered, dropped } = renderSchedulePayload(host, action.payload);

      log.info("inject_schedule: render complete", {
        grid: action.grid,
        rendered,
        dropped,
        slotCount,
      });

      publishScheduleBridgeToPage(schedulePayloadToBridgeState(action.payload));
      log.info("inject_schedule: schedule_updated dispatched via page bridge", { grid: action.grid });

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
