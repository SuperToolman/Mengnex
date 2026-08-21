import * as cordis from "cordis";
import type { Context } from "cordis";

export abstract class ObservabilityGateway extends (cordis as any).Service { protected constructor(ctx: Context, key = "observabilityGateway") { super(ctx, key); } abstract health(): { status: "ok"; mode: string }; abstract replayEvents(limit?: number): Promise<unknown[]>; abstract metrics(): import("./events.js").ObservabilityMetrics; }
declare module "cordis" { interface Context { observabilityGateway: ObservabilityGateway } }
export class DefaultObservabilityGateway extends ObservabilityGateway { health() { return { status: "ok" as const, mode: this.ctx.policy.view().executionMode }; } replayEvents(limit = 100) { return this.ctx.agentEvents.replay({}, limit); } metrics() { return this.ctx.agentEvents.snapshotMetrics(); } }
