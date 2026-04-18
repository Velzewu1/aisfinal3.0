import type { ScheduleInjectPayload } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("schedule-bridge");

export type ScheduleBridgeStatus = "idle" | "generated";

export interface ScheduleBridgeAssignment {
  readonly doctorId: string;
  readonly procedureId: string;
  /** Base label for UI when present (from planner `procedureName`). */
  readonly procedureName?: string;
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
      procedureName: slot.procedureName,
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
 * Content scripts run in an isolated world; the mock page loads `schedule-bridge-listener.js`,
 * which listens on `document.documentElement` for `ai-rpa-schedule-state` and sets `window.__SCHEDULE_STATE__`
 * in the main world (CSP-safe — no inline script or script.textContent injection).
 */
export function publishScheduleBridgeToPage(state: ScheduleBridgeState): void {
  try {
    // documentElement is shared across isolated + page worlds; avoids inline <script> injection (CSP).
    document.documentElement.dispatchEvent(
      new CustomEvent("ai-rpa-schedule-state", { bubbles: true, detail: { state } }),
    );
  } catch (err: unknown) {
    log.error("schedule bridge dispatch failed", err instanceof Error ? err.message : String(err));
    try {
      window.dispatchEvent(
        new CustomEvent("schedule_updated", {
          bubbles: true,
          detail: { source: "bridge_stringify_failed", state: null },
        }),
      );
    } catch (e2: unknown) {
      log.error("schedule bridge fallback event failed", e2 instanceof Error ? e2.message : String(e2));
    }
  }
}

declare global {
  interface Window {
    /** Page-context global; set via mock-ui `schedule-bridge-listener.js`. */
    __SCHEDULE_STATE__?: ScheduleBridgeState;
  }
}

export {};
