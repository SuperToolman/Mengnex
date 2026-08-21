import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ChatMessage } from "./llm.js";
import type { AgentStreamEvent } from "./agent-loop.js";
import type { ExecutionMode, ToolContext } from "./types.js";
import type { AgentSession } from "./sessions.js";

export type ConversationContext = Omit<ToolContext, "executionMode"> & { executionMode?: ExecutionMode };
export abstract class ConversationGateway extends (cordis as any).Service { protected constructor(ctx: Context, key = "conversationGateway") { super(ctx, key); } abstract listSessions(userId: string, archived?: boolean): unknown[]; abstract createSession(userId: string, title: string): Promise<unknown>; abstract getSession(id: string, userId: string): unknown; abstract archiveSession(id: string, userId: string, archived: boolean): Promise<unknown>; abstract closeSession(id: string, userId: string): Promise<unknown>; abstract sendMessage(id: string, userId: string, content: string, context: ConversationContext, onEvent?: (event: AgentStreamEvent) => void): Promise<any>; }
declare module "cordis" { interface Context { conversationGateway: ConversationGateway } }

export class DefaultConversationGateway extends ConversationGateway {
  listSessions(userId: string, archived = false) { return this.ctx.sessions.list(userId, archived).filter((session: AgentSession) => session.turns.length > 0); }
  createSession(userId: string, title: string) { return this.ctx.sessions.create(userId, title); }
  getSession(id: string, userId: string) { return this.ctx.sessions.getOwned(id, userId); }
  archiveSession(id: string, userId: string, archived: boolean) { return this.ctx.sessions.archive(id, userId, archived); }
  closeSession(id: string, userId: string) { return this.ctx.sessions.close(id, userId); }
  async sendMessage(id: string, userId: string, content: string, context: ConversationContext, onEvent?: (event: AgentStreamEvent) => void) {
    const session: AgentSession = this.ctx.sessions.getOwned(id, userId);
    const messages: ChatMessage[] = [];
    for (const turn of session.turns) {
      messages.push({ role: "user", content: turn.user.content.filter((block) => block.type === "text").map((block) => block.text).join("") });
      const reasoning = turn.assistant.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("\n");
      const text = turn.assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const calls = turn.assistant.content.filter((block): block is Extract<typeof block, { type: "tool-call" }> => block.type === "tool-call");
      messages.push({ role: "assistant", content: text, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.length ? { tool_calls: calls.map((call) => ({ id: call.callId, type: "function" as const, function: { name: call.name.replace(/[^a-zA-Z0-9_-]/g, "_"), arguments: JSON.stringify(call.args) } })) } : {}) });
      for (const call of calls) if (call.result !== undefined) messages.push({ role: "tool", tool_call_id: call.callId, content: JSON.stringify(call.result) });
    }
    messages.push({ role: "user", content });
    const tracedContext = { ...context, correlationId: context.correlationId ?? crypto.randomUUID(), sessionId: id, actorId: context.actorId ?? userId, userId };
    const result = await this.ctx.agentLoop.chat(messages, tracedContext, onEvent);
    await this.ctx.sessions.appendInteraction(session.id, userId, content, result);
    return result;
  }
}
