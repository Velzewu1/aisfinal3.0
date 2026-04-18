import type { AgentEvent } from "@ai-rpa/schemas";
import { newCorrelationId } from "./correlation.js";
import { createLogger } from "./logger.js";

const log = createLogger("agent-event-publish");

export function buildAgentEvent<T extends AgentEvent["type"]>(
  type: T,
  correlationId: string,
  payload: Extract<AgentEvent, { type: T }>["payload"],
): Extract<AgentEvent, { type: T }> {
  return {
    id: newCorrelationId(),
    type,
    correlationId,
    ts: new Date().toISOString(),
    payload,
  } as Extract<AgentEvent, { type: T }>;
}

/**
 * Publishes a durable `AgentEvent` the same way `controller/index` does:
 * `chrome.runtime.sendMessage` to the background router (`type: "event"`).
 */
export async function publishAgentEvent(event: AgentEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "event", event });
  } catch (err: unknown) {
    log.warn("agent event publish failed", String(err), event.correlationId);
  }
}
