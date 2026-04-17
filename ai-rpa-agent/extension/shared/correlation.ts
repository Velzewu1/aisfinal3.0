export function newCorrelationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `cid_${c.randomUUID()}`;
  }
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
