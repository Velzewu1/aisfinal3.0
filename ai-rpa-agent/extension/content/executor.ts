import type { DomAction, ExecutorResult } from "@ai-rpa/schemas";
import { selectByDataAttr } from "./selectors.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("executor");

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
      host.dispatchEvent(
        new CustomEvent("schedule-injected", { bubbles: true, detail: action.payload }),
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
