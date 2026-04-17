import { ScheduleResult, type ScheduleRequest } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("backend-client");

const DEFAULT_BASE = "http://localhost:8000";

export class BackendClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  async schedule(req: ScheduleRequest, correlationId: string): Promise<ScheduleResult> {
    const res = await fetch(`${this.baseUrl}/api/schedule`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`backend_error_${res.status}`);
    }
    const raw: unknown = await res.json();
    const parsed = ScheduleResult.safeParse(raw);
    if (!parsed.success) {
      log.warn("invalid schedule response", { issues: parsed.error.issues }, correlationId);
      throw new Error("backend_invalid_schema");
    }
    return parsed.data;
  }
}
