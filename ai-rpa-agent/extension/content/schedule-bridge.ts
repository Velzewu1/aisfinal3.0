import type { ScheduleInjectPayload } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("schedule-bridge");

export type ScheduleBridgeStatus = "idle" | "generated";

export interface ScheduleBridgeAssignment {
  readonly doctorId: string;
  readonly procedureId: string;
  /** Horizon index 0..8 (matches slot time prefix and `data-day-index`). */
  readonly day: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface ScheduleBridgeState {
  readonly assignments: ScheduleBridgeAssignment[];
  readonly status: ScheduleBridgeStatus;
}

function parseSlotTime(raw: string): { day: number; startMinute: number; endMinute: number } | null {
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

/** Maps validated inject payload slots into flat assignment rows for the global bridge. */
export function schedulePayloadToBridgeAssignments(payload: ScheduleInjectPayload): ScheduleBridgeAssignment[] {
  const out: ScheduleBridgeAssignment[] = [];
  for (const slot of payload.slots) {
    const parsed = parseSlotTime(slot.time);
    if (!parsed) continue;
    out.push({
      doctorId: slot.doctorId,
      procedureId: slot.procedureId,
      day: parsed.day,
      startMinute: parsed.startMinute,
      endMinute: parsed.endMinute,
    });
  }
  return out;
}

/** Build bridge state from an inject_schedule payload (trusted, schema-validated). */
export function schedulePayloadToBridgeState(payload: ScheduleInjectPayload): ScheduleBridgeState {
  return {
    assignments: schedulePayloadToBridgeAssignments(payload),
    status: "generated",
  };
}

/**
 * Publishes schedule state to the **page** `window` and dispatches `schedule_updated`.
 *
 * Content scripts run in an isolated world; page scripts (`schedule-renderer.js`, etc.)
 * only see globals set via injection into the page JS context.
 */
function injectPageScript(textContent: string): void {
  const script = document.createElement("script");
  script.setAttribute("data-ai-rpa-schedule-bridge", "");
  script.textContent = textContent;
  const root = document.head ?? document.documentElement;
  root.appendChild(script);
  script.remove();
}

/** Always ends with a page-context `schedule_updated` so mock `schedule-renderer.js` can sync (isolated-world safe). */
export function publishScheduleBridgeToPage(state: ScheduleBridgeState): void {
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(state);
  } catch (err: unknown) {
    log.error("schedule bridge JSON.stringify failed", err instanceof Error ? err.message : String(err));
    injectPageScript(`
(function () {
  try {
    window.dispatchEvent(
      new CustomEvent("schedule_updated", {
        bubbles: true,
        detail: { source: "bridge_stringify_failed", state: null },
      }),
    );
  } catch (e) {
    console.error("[ai-rpa] schedule bridge fallback event failed", e);
  }
})();
`);
    return;
  }

  injectPageScript(`
(function () {
  try {
    window.__SCHEDULE_STATE__ = ${payloadJson};
    window.dispatchEvent(
      new CustomEvent("schedule_updated", {
        bubbles: true,
        detail: { state: window.__SCHEDULE_STATE__, source: "bridge" },
      }),
    );
  } catch (e) {
    console.error("[ai-rpa] schedule bridge publish failed", e);
    try {
      window.dispatchEvent(
        new CustomEvent("schedule_updated", {
          bubbles: true,
          detail: { source: "bridge_runtime_error", state: null },
        }),
      );
    } catch (e2) {
      console.error("[ai-rpa] schedule bridge recovery event failed", e2);
    }
  }
})();
`);
}

declare global {
  interface Window {
    /** Page-context global; set via {@link publishScheduleBridgeToPage}. */
    __SCHEDULE_STATE__?: ScheduleBridgeState;
  }
}

export {};
