import type { AgentEvent } from "@ai-rpa/schemas";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("supabase-sync");

/** Must match `infra/supabase/0001_events.sql` (`public.ai_rpa_events`). */
const AI_RPA_EVENTS_TABLE = "ai_rpa_events" as const;

/**
 * Row shape for Supabase insert — mirrors the migration exactly (snake_case columns).
 *
 * Mapping from `AgentEvent` (persistence only — payload is not transformed):
 *   - `event.id`           → `id` (UUID string; see `rowPrimaryKey`)
 *   - `event.correlationId` → `correlation_id`
 *   - `event.type`         → `type`  (not `event_type`)
 *   - `event.ts`           → `ts`    (canonical event time; not `created_at`)
 *   - `event.payload`      → `payload`
 *   - wall-clock insert    → `inserted_at` (distinct from `ts`; DB also has `default now()`)
 */
type AiRpaEventInsertRow = {
  id: string;
  correlation_id: string;
  type: string;
  ts: string;
  payload: AgentEvent["payload"];
  inserted_at: string;
};

let cachedClient: SupabaseClient | null = null;
let cachedKeyFingerprint: string | null = null;

/**
 * Primary key for `ai_rpa_events.id` (migration: `text` PK storing a UUID string).
 * Prefer the v4 embedded in `cid_<uuid>` event ids when present; otherwise generate.
 */
function rowPrimaryKey(eventId: string): string {
  if (eventId.startsWith("cid_")) {
    const uuid = eventId.slice("cid_".length);
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ) {
      return uuid.toLowerCase();
    }
  }
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  throw new Error("crypto.randomUUID unavailable");
}

function buildInsertRow(event: AgentEvent): AiRpaEventInsertRow {
  return {
    id: rowPrimaryKey(event.id),
    correlation_id: event.correlationId,
    type: event.type,
    ts: event.ts,
    payload: event.payload,
    inserted_at: new Date().toISOString(),
  };
}

function logPostgrestInsertError(
  err: { message: string; code?: string; details?: string; hint?: string },
  event: AgentEvent,
): void {
  log.error(
    "supabase insert failed",
    {
      table: AI_RPA_EVENTS_TABLE,
      eventId: event.id,
      eventType: event.type,
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
    },
    event.correlationId,
  );
}

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

/**
 * Append-only sync: persists events to `public.ai_rpa_events`.
 *
 * Invariants:
 *   - Non-blocking: failures do not throw into the agent loop.
 *   - Failures are always logged at `error` with correlation id and event metadata.
 *   - No decision logic, no DOM, no LLM. Single INSERT per call.
 */
export async function syncEvent(event: AgentEvent): Promise<void> {
  try {
    const supabaseClient = await getClient(event.correlationId);
    if (supabaseClient === null) {
      log.error(
        "supabase client unavailable; event not persisted (check SUPABASE_URL / SUPABASE_ANON_KEY)",
        { table: AI_RPA_EVENTS_TABLE, eventId: event.id, eventType: event.type },
        event.correlationId,
      );
      return;
    }

    const row = buildInsertRow(event);
    const { error } = await supabaseClient.from(AI_RPA_EVENTS_TABLE).insert(row);

    if (error !== null) {
      logPostgrestInsertError(error, event);
      return;
    }

    log.debug("event persisted", { id: event.id, type: event.type }, event.correlationId);
  } catch (err: unknown) {
    log.error(
      "supabase sync failed",
      {
        table: AI_RPA_EVENTS_TABLE,
        eventType: event.type,
        eventId: event.id,
        error: String(err),
      },
      event.correlationId,
    );
  }
}
