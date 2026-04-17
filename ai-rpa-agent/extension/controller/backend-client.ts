import { ScheduleResult, type ScheduleRequest } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("backend-client");

const DEFAULT_BASE = "http://localhost:8000";

export class BackendClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  /**
   * Returns the parsed `ScheduleResult` on success, or `null` on any
   * failure (network error, non-2xx, unparseable body, schema mismatch).
   * Never throws — callers treat `null` as "backend unavailable, skip
   * injection" and the agent loop continues.
   */
  async schedule(req: ScheduleRequest, correlationId: string): Promise<ScheduleResult | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/schedule`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify(req),
      });
    } catch (err: unknown) {
      log.error("backend fetch failed", String(err), correlationId);
      return null;
    }

    if (!res.ok) {
      log.error(
        "backend http error",
        { status: res.status, statusText: res.statusText },
        correlationId,
      );
      return null;
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (err: unknown) {
      log.error("backend response parse failed", String(err), correlationId);
      return null;
    }

    const parsed = ScheduleResult.safeParse(raw);
    if (!parsed.success) {
      log.warn("invalid schedule response", { issues: parsed.error.issues }, correlationId);
      return null;
    }
    return parsed.data;
  }
}
