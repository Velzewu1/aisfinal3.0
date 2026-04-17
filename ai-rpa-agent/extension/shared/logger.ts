type Level = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
  module: string;
  correlationId?: string;
}

function fmt(level: Level, ctx: LoggerContext, msg: string, data?: unknown): string {
  const base = `[ai-rpa][${ctx.module}][${level}]`;
  const cid = ctx.correlationId ? ` cid=${ctx.correlationId}` : "";
  if (data === undefined) return `${base}${cid} ${msg}`;
  try {
    return `${base}${cid} ${msg} ${JSON.stringify(data)}`;
  } catch {
    return `${base}${cid} ${msg} [unserializable]`;
  }
}

export function createLogger(module: string): {
  debug: (msg: string, data?: unknown, cid?: string) => void;
  info: (msg: string, data?: unknown, cid?: string) => void;
  warn: (msg: string, data?: unknown, cid?: string) => void;
  error: (msg: string, data?: unknown, cid?: string) => void;
} {
  return {
    debug: (m, d, cid) => console.debug(fmt("debug", { module, correlationId: cid }, m, d)),
    info: (m, d, cid) => console.info(fmt("info", { module, correlationId: cid }, m, d)),
    warn: (m, d, cid) => console.warn(fmt("warn", { module, correlationId: cid }, m, d)),
    error: (m, d, cid) => console.error(fmt("error", { module, correlationId: cid }, m, d)),
  };
}
