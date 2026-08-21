import * as cordis from "cordis";
import type { Context } from "cordis";
import { readFile } from "node:fs/promises";
import type { GatewayContext } from "./gateway.js";
import type { ScheduleJobInput, ScheduledJob } from "./capabilities.js";

export abstract class AdministrationGateway extends (cordis as any).Service { protected constructor(ctx: Context, key = "administrationGateway") { super(ctx, key); } abstract listTools(): unknown[]; abstract listPlugins(): unknown[]; abstract listPluginSettings(): unknown[]; abstract pluginClient(id: string): Promise<string | undefined>; abstract invokePluginAction(id: string, action: string, input: Record<string, unknown>): Promise<unknown>; abstract updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean): Promise<unknown>; abstract updatePluginPackage(id: string): Promise<unknown>; abstract rollbackPlugin(id: string, revisionId: string): Promise<unknown>; abstract listJobs(owner?: string): ScheduledJob[]; abstract scheduleJob(input: ScheduleJobInput): Promise<ScheduledJob>; abstract cancelJob(id: string): Promise<ScheduledJob>; abstract approveJobReview(id: string): Promise<ScheduledJob>; abstract runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }): Promise<any>; abstract decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext): Promise<any>; }
declare module "cordis" { interface Context { administrationGateway: AdministrationGateway } }

export class DefaultAdministrationGateway extends AdministrationGateway {
  listTools() { return this.ctx.agent.listTools(); }
  listPlugins() { return this.ctx.pluginManager.list(); }
  listPluginSettings() { return this.ctx.pluginUi.listSettings(); }
  async pluginClient(id: string) { const client = this.ctx.pluginManager.clientModule(id); return client ? readFile(client.entryPath, "utf8") : undefined; }
  invokePluginAction(id: string, action: string, input: Record<string, unknown>) { return this.ctx.pluginApi.invoke(id, action, input); }
  updatePlugin(id: string, config: Record<string, unknown>, enabled: boolean) { return this.ctx.pluginManager.update(id, config, enabled); }
  updatePluginPackage(id: string) { return this.ctx.pluginManager.updatePackage(id); }
  rollbackPlugin(id: string, revisionId: string) { return this.ctx.pluginManager.rollback(id, revisionId); }
  listJobs(owner?: string) { return this.ctx.jobs.list(owner); }
  scheduleJob(input: ScheduleJobInput) { if (input.sessionId) this.ctx.sessions.getOwned(input.sessionId, input.owner); return this.ctx.jobs.schedule(input); }
  cancelJob(id: string) { return this.ctx.jobs.cancel(id); }
  approveJobReview(id: string) { return this.ctx.jobs.approveReview(id); }
  runTool(tool: string, args: Record<string, unknown>, context: GatewayContext & { libraryId?: string }) { return this.ctx.agent.invoke(tool, args, context); }
  decideApproval(id: string, decision: "approve" | "reject", context: GatewayContext) { return this.ctx.agent.decideApproval(id, decision, context); }
}
