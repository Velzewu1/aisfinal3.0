import type { AgentEvent } from "@ai-rpa/schemas";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("supabase-sync");

/**
 * Append-only sync: persists events to the Supabase `ai_rpa_events` table.
 *
 * Row shape mirrors `infra/supabase/0001_events.sql`:
 *   id / correlation_id / type / ts / payload (+ inserted_at defaults).
 *
 * Invariants:
 *   - Non-blocking relative to the agent loop: a failed insert never throws,
 *     so the pipeline cannot be crashed by the audit sink.
 *   - Failures are NOT silent: each one logs via `createLogger` (`warn`/`error`)
 *     with `correlationId` + event metadata so the audit gap is visible.
 *   - No decision logic, no DOM, no LLM. Only a single INSERT per event.
 *   - Client is lazily constructed once `SUPABASE_URL` and
 *     `SUPABASE_ANON_KEY` are present in `chrome.storage.local`.
 */

let cachedClient: SupabaseClient | null = null;
let cachedKeyFingerprint: string | null = null;

async function getClient(correlationId?: string): Promise<SupabaseClient | null> {
  try {
    const stored = await chrome.storage.local.get([
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
    ]);
    const url = stored["SUPABASE_URL"];
    const anonKey = stored["SUPABASE_ANON_KEY"];
    if (typeof url !== "string" || url.length === 0) return null;
    if (typeof anonKey !== "string" || anonKey.length === 0) return null;

    const fingerprint = `${url}::${anonKey.slice(0, 8)}`;
    if (cachedClient !== null && cachedKeyFingerprint === fingerprint) {
      return cachedClient;
    }

    cachedClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cachedKeyFingerprint = fingerprint;
    return cachedClient;
  } catch (err: unknown) {
    log.error(
      "supabase client init failed",
      { error: String(err) },
      correlationId,
    );
    return null;
  }
}

export async function syncEvent(event: AgentEvent): Promise<void> {
  try {
    const supabaseClient = await getClient(event.correlationId);
    if (supabaseClient === null) {
      log.warn(
        "supabase client unavailable; event not persisted",
        { id: event.id, type: event.type },
        event.correlationId,
      );
      return;
    }

    const { error } = await supabaseClient.from("ai_rpa_events").insert({
      id: event.id,
      correlation_id: event.correlationId,
      type: event.type,
      ts: event.ts,
      payload: event.payload,
    });

    if (error !== null) {
      log.error(
        "supabase insert failed",
        {
          eventType: event.type,
          eventId: event.id,
          message: error.message,
          code: error.code,
        },
        event.correlationId,
      );
      return;
    }

    log.debug("event persisted", { id: event.id, type: event.type }, event.correlationId);
  } catch (err: unknown) {
    log.error(
      "supabase sync failed",
      { eventType: event.type, eventId: event.id, error: String(err) },
      event.correlationId,
    );
  }
}
