import type { AgentEvent } from "@ai-rpa/schemas";

type Listener = (event: AgentEvent) => void;

class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly buffer: AgentEvent[] = [];
  private static readonly BUFFER_MAX = 500;

  publish(event: AgentEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > EventBus.BUFFER_MAX) this.buffer.shift();
    for (const l of this.listeners) l(event);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit = 50): AgentEvent[] {
    return this.buffer.slice(-limit);
  }
}

export const eventBus = new EventBus();
