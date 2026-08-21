import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentStreamEvent } from "./agent-loop.js";
import type { ConversationContext } from "./gateway-conversation.js";
import type { ScheduleJobInput, ScheduledJob } from "./capabilities.js";

export type GatewayContext = ConversationContext;
export abstract class AgentGatewayFacade extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "gateway") { super(ctx, key); }
  abstract health(): { status: "ok"; mode: string }; abstract metrics(): import("./events.js").ObservabilityMetrics; abstract listTools(): unknown[]; abstract listPlugins(): unknown[]; abstract listPluginSettings(): unknown[]; abstract pluginClient(id: string): Promise<string | undefined>; abstract invokePluginAction(id: string, action: string, input: Record<string, unknown>): Promise<unknown>; abstract updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean): Promise<unknown>; abstract updatePluginPackage(id: string): Promise<unknown>; abstract rollbackPlugin(id: string, revisionId: string): Promise<unknown>; abstract listJobs(owner?: string): ScheduledJob[]; abstract scheduleJob(input: ScheduleJobInput): Promise<ScheduledJob>; abstract cancelJob(id: string): Promise<ScheduledJob>; abstract approveJobReview(id: string): Promise<ScheduledJob>; abstract replayEvents(limit?: number): Promise<unknown[]>; abstract listSessions(userId: string, archived?: boolean): unknown[]; abstract createSession(userId: string, title: string): Promise<unknown>; abstract getSession(id: string, userId: string): unknown; abstract archiveSession(id: string, userId: string, archived: boolean): Promise<unknown>; abstract closeSession(id: string, userId: string): Promise<unknown>; abstract sendMessage(id: string, userId: string, content: string, context: GatewayContext, onEvent?: (event: AgentStreamEvent) => void): Promise<any>; abstract runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }): Promise<any>; abstract decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext): Promise<any>;
}
declare module "cordis" { interface Context { gateway: AgentGatewayFacade } }

export class DefaultAgentGatewayFacade extends AgentGatewayFacade {
  constructor(ctx: Context) { super(ctx); }
  health() { return this.ctx.observabilityGateway.health(); }
  metrics() { return this.ctx.observabilityGateway.metrics(); }
  listTools() { return this.ctx.administrationGateway.listTools(); }
  listPlugins() { return this.ctx.administrationGateway.listPlugins(); }
  listPluginSettings() { return this.ctx.administrationGateway.listPluginSettings(); }
  pluginClient(id: string) { return this.ctx.administrationGateway.pluginClient(id); }
  invokePluginAction(id: string, action: string, input: Record<string, unknown>) { return this.ctx.administrationGateway.invokePluginAction(id, action, input); }
  updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean) { return this.ctx.administrationGateway.updatePlugin(id, config, enabled); }
  updatePluginPackage(id: string) { return this.ctx.administrationGateway.updatePluginPackage(id); }
  rollbackPlugin(id: string, revisionId: string) { return this.ctx.administrationGateway.rollbackPlugin(id, revisionId); }
  listJobs(owner?: string) { return this.ctx.administrationGateway.listJobs(owner); }
  scheduleJob(input: ScheduleJobInput) { return this.ctx.administrationGateway.scheduleJob(input); }
  cancelJob(id: string) { return this.ctx.administrationGateway.cancelJob(id); }
  approveJobReview(id: string) { return this.ctx.administrationGateway.approveJobReview(id); }
  replayEvents(limit = 100) { return this.ctx.observabilityGateway.replayEvents(limit); }
  listSessions(userId: string, archived = false) { return this.ctx.conversationGateway.listSessions(userId, archived); }
  createSession(userId: string, title: string) { return this.ctx.conversationGateway.createSession(userId, title); }
  getSession(id: string, userId: string) { return this.ctx.conversationGateway.getSession(id, userId); }
  archiveSession(id: string, userId: string, archived: boolean) { return this.ctx.conversationGateway.archiveSession(id, userId, archived); }
  closeSession(id: string, userId: string) { return this.ctx.conversationGateway.closeSession(id, userId); }
  sendMessage(id: string, userId: string, content: string, context: GatewayContext, onEvent?: (event: AgentStreamEvent) => void) { return this.ctx.conversationGateway.sendMessage(id, userId, content, context, onEvent); }
  runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }) { return this.ctx.administrationGateway.runTool(tool, args, context); }
  decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext) { return this.ctx.administrationGateway.decideApproval(id, decision, context); }
}
