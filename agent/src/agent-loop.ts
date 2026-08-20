import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ChatMessage, ChatTool } from "./llm.js";
import type { ToolContext } from "./types.js";
import type { AssistantBlock } from "./conversation.js";
import { toolCallBlock } from "./conversation.js";

export type ToolCallRecord = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "completed" | "approval_required";
  result?: unknown;
  approvalId?: string;
  createdAt: string;
  completedAt?: string;
};

export type AgentStreamEvent =
  | { type: "agent:turn"; turn: number; toolCount: number }
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool/call"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool/result"; callId: string; name: string; result: unknown; status: ToolCallRecord["status"] }
  | { type: "done"; status: "completed" | "approval_required"; model: string }
  | { type: "snapshot"; result: unknown }
  | { type: "error"; message: string };

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

  async chat(messages: ChatMessage[], context: Omit<ToolContext, "executionMode">, onEvent?: (event: AgentStreamEvent) => void) {
    const { tools, toolNames } = modelTools(this.ctx.agent.listTools());
    const system = this.ctx.agentContext?.systemMessage();
    const conversation = system ? [system, ...messages] : [...messages];
    const toolCalls: ToolCallRecord[] = [];
    const blocks: AssistantBlock[] = [];

    for (let turn = 0; turn < 5; turn += 1) {
      const turnEvent = { type: "agent:turn" as const, turn: turn + 1, toolCount: tools.length };
      onEvent?.(turnEvent);
      await this.ctx.agentEvents?.emit("agent:turn", { turn: turn + 1, toolCount: tools.length });
      const completion = await this.ctx.llm.complete(conversation, tools);
      if (completion.reasoning) { blocks.push({ type: "reasoning", text: completion.reasoning }); onEvent?.({ type: "reasoning-delta", text: completion.reasoning }); }
      if (completion.content) { blocks.push({ type: "text", text: completion.content }); onEvent?.({ type: "text-delta", text: completion.content }); }
      if (!completion.tool_calls.length) { onEvent?.({ type: "done", status: "completed", model: completion.model }); return { status: "completed" as const, content: completion.content, model: completion.model, toolCalls, blocks }; }
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
        const startedAt = new Date().toISOString();
        onEvent?.({ type: "tool/call", callId: call.id, name: toolName, args });
        const result = await this.ctx.agent.invoke(toolName, args, context);
        if (result.status === "approval_required") {
          if (!result.approval) throw new Error("agent runtime returned an approval without details");
          const record = { id: call.id, toolName, args, status: "approval_required" as const, approvalId: result.approval.id, createdAt: startedAt };
          toolCalls.push(record);
          blocks.push(toolCallBlock(record));
          onEvent?.({ type: "tool/result", callId: call.id, name: toolName, result: { approval: result.approval }, status: "approval_required" });
          onEvent?.({ type: "done", status: "approval_required", model: completion.model });
          return { status: "approval_required" as const, content: completion.content || "需要批准后才能继续执行。", model: completion.model, approval: result.approval, toolCalls, blocks };
        }
        const record = { id: call.id, toolName, args, status: "completed" as const, result: result.result, createdAt: startedAt, completedAt: new Date().toISOString() };
        toolCalls.push(record);
        blocks.push(toolCallBlock(record));
        onEvent?.({ type: "tool/result", callId: call.id, name: toolName, result: result.result, status: "completed" });
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
