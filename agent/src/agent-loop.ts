import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ChatMessage, ChatTool } from "./llm.js";
import type { ToolContext } from "./types.js";
import type { AssistantBlock } from "./conversation.js";
import { toolCallBlock } from "./conversation.js";
import { CapabilityDeniedError } from "./runtime.js";

export type ToolCallRecord = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "completed" | "approval_required";
  result?: unknown;
  approvalId?: string;
  createdAt: string;
  completedAt?: string;
  correlationId?: string;
  executionState?: "completed" | "approval_required";
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
    const toolProtocol = { role: "system" as const, content: "When tools are available, call them only through the provided function-calling interface. Never write XML or pseudo-tool syntax such as <invoke> in assistant text. After a tool result, provide a concise user-facing answer instead of repeating the same call." };
    const conversation = [toolProtocol, ...(system ? [system] : []), ...messages];
    const toolCalls: ToolCallRecord[] = [];
    const blocks: AssistantBlock[] = [];
    const executedCalls = new Map<string, unknown>();

    // Continue until the model reaches a terminal response. Safety comes from
    // protocol validation, idempotent call detection, cancellation, and the
    // provider/context budget rather than an arbitrary turn count.
    let turn = 0;
    while (true) {
      turn += 1;
      const turnId = context.turnId ?? `${context.sessionId ?? "run"}:${crypto.randomUUID()}`;
      const turnContext = { ...context, turnId };
      const turnEvent = { type: "agent:turn" as const, turn: turn + 1, toolCount: tools.length };
      onEvent?.(turnEvent);
      await this.ctx.agentEvents?.emit("agent:turn", { turn: turn + 1, toolCount: tools.length }, undefined, turnContext);
      let completion: Awaited<ReturnType<AgentLoopService["completeWithStream"]>>;
      try {
        completion = await this.completeWithStream(conversation, tools, onEvent, turnContext);
      } catch (error) {
        const message = friendlyLlmError(error);
        const block: AssistantBlock = { type: "text", text: message };
        onEvent?.({ type: "text-delta", text: message });
        onEvent?.({ type: "done", status: "completed", model: "unknown" });
        return { status: "completed" as const, content: message, model: "unknown", toolCalls, blocks: [...blocks, block] };
      }
      if (completion.reasoning) blocks.push({ type: "reasoning", text: completion.reasoning });
      if (completion.content) blocks.push({ type: "text", text: completion.content });
      if (!completion.tool_calls.length) { onEvent?.({ type: "done", status: "completed", model: completion.model }); return { status: "completed" as const, content: completion.content, model: completion.model, toolCalls, blocks }; }
      conversation.push({ role: "assistant", content: completion.content, ...(completion.reasoning ? { reasoning_content: completion.reasoning } : {}), tool_calls: completion.tool_calls });
      for (const call of completion.tool_calls) {
        const resolvedName = resolveModelToolName(call.function.name, toolNames);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          const invalid = { error: { code: "INVALID_ARGUMENTS", message: "工具参数不是有效 JSON，已跳过本次调用。", tool: resolvedName ?? call.function.name } };
          conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(invalid) });
          onEvent?.({ type: "tool/result", callId: call.id, name: resolvedName ?? call.function.name, result: invalid, status: "completed" });
          continue;
        }
        const toolName = resolvedName;
        if (!toolName) {
          const unknown = { error: { code: "UNKNOWN_TOOL", message: `未注册工具：${call.function.name}`, tool: call.function.name } };
          conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(unknown) });
          onEvent?.({ type: "tool/result", callId: call.id, name: call.function.name, result: unknown, status: "completed" });
          continue;
        }
        const startedAt = new Date().toISOString();
        const callFingerprint = `${toolName}:${JSON.stringify(args)}`;
        if (executedCalls.has(callFingerprint)) {
          const previousResult = executedCalls.get(callFingerprint);
          const message = toolName === "media.search" && isEmptySearchResult(previousResult)
            ? `媒体库中没有找到与“${String(args.query ?? "").trim()}”匹配的资源。`
            : "相同工具请求已返回过结果，Agent 已停止重复调用。";
          const block: AssistantBlock = { type: "text", text: message };
          blocks.push(block);
          onEvent?.({ type: "text-delta", text: message });
          onEvent?.({ type: "done", status: "completed", model: completion.model });
          return { status: "completed" as const, content: message, model: completion.model, toolCalls, blocks };
        }
        onEvent?.({ type: "tool/call", callId: call.id, name: toolName, args });
        let result;
        try {
          result = await this.ctx.agent.invoke(toolName, args, { ...turnContext, toolCallId: call.id });
        } catch (error) {
          const denied = error instanceof CapabilityDeniedError
            ? { error: { code: "CAPABILITY_DENIED", capabilities: error.capabilities, message: "The requested tool is not enabled for this conversation." } }
            : { error: { code: error instanceof Error && "code" in error ? String((error as Error & { code?: unknown }).code) : "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : "工具执行失败", tool: toolName } };
          const record = { id: call.id, toolName, args, status: "completed" as const, result: denied, createdAt: startedAt, completedAt: new Date().toISOString() };
          toolCalls.push(record);
          blocks.push(toolCallBlock(record));
          onEvent?.({ type: "tool/result", callId: call.id, name: toolName, result: denied, status: "completed" });
          conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(denied) });
          continue;
        }
        if (result.status === "approval_required") {
          if (!result.approval) throw new Error("agent runtime returned an approval without details");
          const record = { id: call.id, toolName, args, status: "approval_required" as const, executionState: "approval_required" as const, approvalId: result.approval.id, createdAt: startedAt, correlationId: turnContext.correlationId };
          toolCalls.push(record);
          blocks.push(toolCallBlock(record));
          onEvent?.({ type: "tool/result", callId: call.id, name: toolName, result: { approval: result.approval }, status: "approval_required" });
          onEvent?.({ type: "done", status: "approval_required", model: completion.model });
          return { status: "approval_required" as const, content: completion.content || "需要批准后才能继续执行。", model: completion.model, approval: result.approval, toolCalls, blocks };
        }
        const record = { id: call.id, toolName, args, status: "completed" as const, executionState: "completed" as const, result: result.result, createdAt: startedAt, completedAt: new Date().toISOString(), correlationId: turnContext.correlationId };
        executedCalls.set(callFingerprint, result.result);
        toolCalls.push(record);
        blocks.push(toolCallBlock(record));
        onEvent?.({ type: "tool/result", callId: call.id, name: toolName, result: result.result, status: "completed" });
        conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.result) });
      }
    }
  }

  private async completeWithStream(conversation: ChatMessage[], tools: ChatTool[], onEvent?: (event: AgentStreamEvent) => void, context: Omit<ToolContext, "executionMode"> = {}) {
    let content = ""; let reasoning = ""; let model = ""; let usage; const calls = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
    for await (const delta of this.ctx.llm.stream(conversation, tools, { context })) {
      model = delta.model ?? model; usage = delta.usage ?? usage;
      if (delta.content) { content += delta.content; onEvent?.({ type: "text-delta", text: delta.content }); }
      if (delta.reasoning) { reasoning += delta.reasoning; onEvent?.({ type: "reasoning-delta", text: delta.reasoning }); }
      if (delta.toolCall) { const current = calls.get(delta.toolCall.index) ?? { id: delta.toolCall.id ?? crypto.randomUUID(), type: "function" as const, function: { name: "", arguments: "" } }; current.id = delta.toolCall.id ?? current.id; current.function.name += delta.toolCall.name ?? ""; current.function.arguments += delta.toolCall.arguments ?? ""; calls.set(delta.toolCall.index, current); }
    }
    return { content, reasoning, tool_calls: [...calls.values()], model, ...(usage ? { usage } : {}) };
  }
}

function isEmptySearchResult(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [record.items, record.results, record.data].some((entry) => Array.isArray(entry) && entry.length === 0);
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

function resolveModelToolName(value: string, names: Map<string, string>) {
  if (names.has(value)) return names.get(value);
  const matches = [...names.keys()].map((name) => ({ name, index: value.indexOf(name) })).filter((entry) => entry.index >= 0).sort((a, b) => a.index - b.index || b.name.length - a.name.length);
  return matches[0] ? names.get(matches[0].name) : undefined;
}

function friendlyLlmError(error: unknown) {
  const message = error instanceof Error ? error.message : "模型请求失败";
  if (/reasoning_content|thinking mode/i.test(message)) return "模型思考模式的上下文格式不兼容，Agent 已拦截这次请求。请重试；如果仍然失败，请关闭思考模式或重新选择模型。";
  if (/\b400\b|protocol|invalid request/i.test(message)) return "模型拒绝了这次请求，通常是模型能力或请求格式不匹配。请检查当前模型配置后重试。";
  if (/authentication|401|403/i.test(message)) return "模型供应商鉴权失败，请到模型供应商设置中检查 API 密钥。";
  if (/timeout|network|fetch/i.test(message)) return "模型服务暂时不可达，请稍后重试。";
  return "模型请求失败，Agent 未能完成这次请求。请稍后重试。";
}
