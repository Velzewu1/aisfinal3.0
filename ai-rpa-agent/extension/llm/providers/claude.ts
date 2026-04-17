import type { LlmProvider, LlmRequest } from "../client.js";

/**
 * Skeleton Claude provider (Tool Use JSON mode).
 * Network call intentionally not implemented in this scaffold.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = "claude" as const;

  constructor(private readonly _apiKey: string) {
    void this._apiKey;
  }

  async interpret(_req: LlmRequest): Promise<unknown> {
    void _req;
    throw new Error("llm_not_implemented: claude provider is a scaffold");
  }
}
