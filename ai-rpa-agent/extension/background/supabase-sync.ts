import type { AgentEvent } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("supabase-sync");

/**
 * Skeleton sync: persists events to an append-only Supabase table.
 * Implementation deferred; must remain non-blocking relative to the agent loop.
 */
export async function syncEvent(event: AgentEvent): Promise<void> {
  try {
    log.debug("queued for supabase", { id: event.id, type: event.type }, event.correlationId);
  } catch (err: unknown) {
    log.warn("sync failed", String(err), event.correlationId);
  }
}
