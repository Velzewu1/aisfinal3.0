import { LlmInterpretation } from "@ai-rpa/schemas";
import type { LlmInterpretation as LlmInterpretationType } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("llm");

export interface LlmRequest {
  correlationId: string;
  utterance: string;
  pageContext: {
    pageId?: string;
    patientId?: string;
  };
}

export interface LlmProvider {
  readonly name: "claude" | "openai";
  interpret(req: LlmRequest): Promise<unknown>;
}

/**
 * LLM client wrapper.
 *
 * Contract:
 *   - Input: natural language utterance + page context.
 *   - Output: validated `LlmInterpretation` JSON ONLY.
 *   - The provider returns raw JSON; this wrapper validates with Zod before returning.
 *   - NEVER executes code, NEVER touches DOM, NEVER calls the backend.
 *   - If validation fails, throws `LlmValidationError` with raw response attached.
 */
export class LlmClient {
  constructor(private readonly provider: LlmProvider) {}

  async interpret(req: LlmRequest): Promise<LlmInterpretationType> {
    const raw = await this.provider.interpret(req);
    const parsed = LlmInterpretation.safeParse(raw);
    if (!parsed.success) {
      log.warn("invalid LLM JSON", { issues: parsed.error.issues }, req.correlationId);
      throw new LlmValidationError("llm_invalid_json", raw, parsed.error.issues.map((i) => i.message));
    }
    return parsed.data;
  }
}

export class LlmValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown,
    public readonly errors: string[],
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}
