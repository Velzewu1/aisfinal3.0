export function newCorrelationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `cid_${c.randomUUID()}`;
  }
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * ISO-8601 wall time. For `AgentEvent.ts`, call at construction (each call is a
 * fresh `new Date().toISOString()` — never cached or interpolated).
 */
export function nowIso(): string {
  return new Date().toISOString();
}
