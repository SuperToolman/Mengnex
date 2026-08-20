import { readFile } from "node:fs/promises";
import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ChatMessage } from "./llm.js";
import type { ToolContext } from "./types.js";
import type { ScheduleJobInput, ScheduledJob } from "./capabilities.js";

export type GatewayUser = { id: string; role: string };
export type GatewayContext = Omit<ToolContext, "executionMode">;

export abstract class AgentGatewayFacade extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "gateway") { super(ctx, key); }
  abstract health(): { status: "ok"; mode: string };
  abstract listTools(): unknown[];
  abstract listPlugins(): unknown[];
  abstract listPluginSettings(): unknown[];
  abstract pluginClient(id: string): Promise<string | undefined>;
  abstract invokePluginAction(id: string, action: string, input: Record<string, unknown>): Promise<unknown>;
  abstract updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean): Promise<unknown>;
  abstract updatePluginPackage(id: string): Promise<unknown>;
  abstract rollbackPlugin(id: string, revisionId: string): Promise<unknown>;
  abstract listJobs(owner?: string): ScheduledJob[];
  abstract scheduleJob(input: ScheduleJobInput): Promise<ScheduledJob>;
  abstract cancelJob(id: string): Promise<ScheduledJob>;
  abstract replayEvents(limit?: number): Promise<unknown[]>;
  abstract listSessions(userId: string): unknown[];
  abstract createSession(userId: string, title: string): Promise<unknown>;
  abstract getSession(id: string, userId: string): unknown;
  abstract sendMessage(id: string, userId: string, content: string, context: GatewayContext): Promise<any>;
  abstract chat(messages: ChatMessage[], context: GatewayContext): Promise<any>;
  abstract runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }): Promise<any>;
  abstract decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext): Promise<any>;
}

declare module "cordis" { interface Context { gateway: AgentGatewayFacade; } }

export class DefaultAgentGatewayFacade extends AgentGatewayFacade {
  constructor(ctx: Context) { super(ctx); }
  health() { return { status: "ok" as const, mode: this.ctx.policy.view().executionMode }; }
  listTools() { return this.ctx.agent.listTools(); }
  listPlugins() { return this.ctx.pluginManager.list(); }
  listPluginSettings() { return this.ctx.pluginUi.listSettings(); }
  async pluginClient(id: string) {
    const client = this.ctx.pluginManager.clientModule(id);
    return client ? readFile(client.entryPath, "utf8") : undefined;
  }
  invokePluginAction(id: string, action: string, input: Record<string, unknown>) { return this.ctx.pluginApi.invoke(id, action, input); }
  updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean) { return this.ctx.pluginManager.update(id, config, enabled); }
  updatePluginPackage(id: string) { return this.ctx.pluginManager.updatePackage(id); }
  rollbackPlugin(id: string, revisionId: string) { return this.ctx.pluginManager.rollback(id, revisionId); }
  listJobs(owner?: string) { return this.ctx.jobs.list(owner); }
  scheduleJob(input: ScheduleJobInput) { return this.ctx.jobs.schedule(input); }
  cancelJob(id: string) { return this.ctx.jobs.cancel(id); }
  replayEvents(limit = 100) { return this.ctx.agentEvents.replay({}, limit); }
  listSessions(userId: string) { return this.ctx.sessions.list(userId); }
  createSession(userId: string, title: string) { return this.ctx.sessions.create(userId, title); }
  getSession(id: string, userId: string) { return this.ctx.sessions.getOwned(id, userId); }
  async sendMessage(id: string, userId: string, content: string, context: GatewayContext) {
    const session = this.ctx.sessions.getOwned(id, userId);
    await this.ctx.sessions.append(id, userId, [{ role: "user", content }]);
    const refreshed = this.ctx.sessions.getOwned(id, userId);
    const result = await this.ctx.agentLoop.chat(refreshed.messages, context);
    await this.ctx.sessions.appendToolCalls(session.id, userId, result.toolCalls);
    await this.ctx.sessions.append(id, userId, [{ role: "assistant", content: result.content }]);
    return result;
  }
  chat(messages: ChatMessage[], context: GatewayContext) { return this.ctx.agentLoop.chat(messages, context); }
  runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }) { return this.ctx.agent.invoke(tool, args, context); }
  decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext) { return this.ctx.agent.decideApproval(id, decision, context); }
}
