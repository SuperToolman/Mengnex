import * as cordis from "cordis";
import type { Context } from "cordis";

declare module "cordis" {
  interface Context { agentContext: AgentContextService; }
}

/** Contributions are supplied by skill plugins and become an explicit system message. */
export class AgentContextService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly contributions = new Map<string, string>();

  constructor(ctx: Context) { super(ctx, "agentContext"); }

  register(id: string, instruction: string) {
    if (!id || !instruction.trim()) throw new Error("skill id and instruction are required");
    this.contributions.set(id, instruction.trim());
    return () => this.contributions.delete(id);
  }

  systemMessage() {
    const content = [...this.contributions.values()].join("\n\n");
    return content ? { role: "system" as const, content } : undefined;
  }
}
