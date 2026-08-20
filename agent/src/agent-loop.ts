import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ChatMessage, ChatTool } from "./llm.js";
import type { ToolContext } from "./types.js";

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  status: "completed" | "approval_required";
  result?: unknown;
  approvalId?: string;
  createdAt: string;
};

declare module "cordis" {
  interface Context {
    agentLoop: AgentLoopService;
  }
}

export class AgentLoopService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  constructor(ctx: Context) {
    super(ctx, "agentLoop");
  }

  async chat(messages: ChatMessage[], context: Omit<ToolContext, "executionMode">) {
    const { tools, toolNames } = modelTools(this.ctx.agent.listTools());
    const system = this.ctx.agentContext?.systemMessage();
    const conversation = system ? [system, ...messages] : [...messages];
    const toolCalls: ToolCallRecord[] = [];

    for (let turn = 0; turn < 5; turn += 1) {
      await this.ctx.agentEvents?.emit("agent:turn", { turn: turn + 1, toolCount: tools.length });
      const completion = await this.ctx.llm.complete(conversation, tools);
      if (!completion.tool_calls.length) return { status: "completed" as const, content: completion.content, model: completion.model, toolCalls };
      conversation.push({ role: "assistant", content: completion.content, tool_calls: completion.tool_calls });
      for (const call of completion.tool_calls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          throw new Error(`invalid arguments for tool ${call.function.name}`);
        }
        const toolName = toolNames.get(call.function.name);
        if (!toolName) throw new Error(`model requested an unknown tool: ${call.function.name}`);
        const result = await this.ctx.agent.invoke(toolName, args, context);
        if (result.status === "approval_required") {
          if (!result.approval) throw new Error("agent runtime returned an approval without details");
          toolCalls.push({ toolName, args, status: "approval_required", approvalId: result.approval.id, createdAt: new Date().toISOString() });
          return { status: "approval_required" as const, content: completion.content || "需要批准后才能继续执行。", model: completion.model, approval: result.approval, toolCalls };
        }
        toolCalls.push({ toolName, args, status: "completed", result: result.result, createdAt: new Date().toISOString() });
        conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.result) });
      }
    }
    throw new Error("agent tool call limit exceeded");
  }
}

type ToolMetadata = { name: string; description: string; inputSchema: Record<string, unknown> };

/** OpenAI-compatible function names cannot contain dots, unlike Mengnex tool names. */
export function modelTools(registry: ToolMetadata[]) {
  const toolNames = new Map<string, string>();
  const tools = registry.map((tool) => {
    const name = modelToolName(tool.name, toolNames);
    toolNames.set(name, tool.name);
    return { type: "function" as const, function: { name, description: tool.description, parameters: tool.inputSchema } };
  }) as ChatTool[];
  return { tools, toolNames };
}

function modelToolName(toolName: string, existing: Map<string, string>) {
  const base = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 58) || "tool";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `${base.slice(0, 58)}_${suffix++}`;
  return candidate;
}
