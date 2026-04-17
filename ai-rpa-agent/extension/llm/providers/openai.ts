import type { LlmProvider, LlmRequest } from "../client.js";

/**
 * Skeleton OpenAI provider (structured outputs).
 * Network call intentionally not implemented in this scaffold.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai" as const;

  constructor(private readonly _apiKey: string) {
    void this._apiKey;
  }

  async interpret(_req: LlmRequest): Promise<unknown> {
    void _req;
    throw new Error("llm_not_implemented: openai provider is a scaffold");
  }
}
