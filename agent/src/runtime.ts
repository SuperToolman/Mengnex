import * as cordis from "cordis";
import type { Context } from "cordis";
import type { Approval, ToolContext } from "./types.js";
import type { ExecutionPolicy } from "./execution-policy.js";
import { requiresApproval } from "./policy.js";

export class CapabilityDeniedError extends Error {
  constructor(readonly capabilities: string[]) {
    super(`capability denied: ${capabilities.join(", ")}`);
    this.name = "CapabilityDeniedError";
  }
}

declare module "cordis" {
  interface Context {
    agent: AgentRuntime;
  }
}

export class AgentRuntime extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly policy: ExecutionPolicy;

  constructor(ctx: Context, policy: ExecutionPolicy) {
    super(ctx, "agent");
    this.policy = policy;
  }

  listTools() { return this.ctx.tools.list(); }

  async invoke(toolName: string, args: Record<string, unknown>, context: Omit<ToolContext, "executionMode"> = {}) {
    const tool = this.ctx.tools.get(toolName);
    if (!tool) throw new Error(`unknown agent tool: ${toolName}`);
    const policy = this.policy.view();
    const missing = tool.capabilities.filter((capability) => !policy.allowedCapabilities.includes(capability));
    if (missing.length) throw new CapabilityDeniedError(missing);
    const executionMode = policy.executionMode ?? "approve_high_risk";
    const toolContext = { ...context, correlationId: context.correlationId ?? crypto.randomUUID(), executionMode };
    if (requiresApproval(executionMode, tool.risk)) {
      const id = crypto.randomUUID();
      const approval: Approval = { id, toolName, args, userId: context.userId, actorId: context.actorId ?? context.userId, correlationId: toolContext.correlationId, sessionId: context.sessionId, turnId: context.turnId, toolCallId: context.toolCallId, parentJobId: context.parentJobId, risk: tool.risk, status: "pending", createdAt: new Date().toISOString() };
      await this.ctx.agentEvents?.audit("tool.approval_required", "tool", toolName, { approvalId: id }, approval);
      return { status: "approval_required", approval: await this.ctx.approvals.create(approval) };
    }
    const result = await this.ctx.tools.execute(toolName, args, toolContext);
    return { status: "completed", result };
  }

  async decideApproval(id: string, decision: "approve" | "reject", context: Omit<ToolContext, "executionMode"> = {}) {
    const approval = this.ctx.approvals.getPending(id);
    if (!approval) throw new Error("approval is not pending");
    if (approval.userId && context.userId && approval.userId !== context.userId) throw new Error("approval belongs to another user");
    approval.status = decision === "approve" ? "approved" : "rejected";
    approval.decidedAt = new Date().toISOString();
    const eventContext = { correlationId: approval.correlationId ?? context.correlationId ?? crypto.randomUUID(), sessionId: approval.sessionId ?? context.sessionId, turnId: approval.turnId ?? context.turnId, toolCallId: approval.toolCallId ?? context.toolCallId, actorId: context.actorId ?? context.userId ?? approval.actorId ?? approval.userId, parentJobId: approval.parentJobId ?? context.parentJobId };
    const waitMs = Math.max(0, Date.parse(approval.decidedAt) - Date.parse(approval.createdAt));
    await this.ctx.agentEvents?.emit("approval:decided", { approvalId: id, toolName: approval.toolName, decision, waitMs, outcome: "completed" }, undefined, eventContext);
    if (decision === "reject") {
      await this.ctx.approvals.save();
      await this.ctx.agentEvents?.audit("tool.approval_rejected", "tool", approval.toolName, { approvalId: id, waitMs }, eventContext);
      return { status: "rejected", approval };
    }
    await this.ctx.approvals.save();
    const executionMode = this.policy.view().executionMode ?? "approve_high_risk";
    const result = await this.ctx.tools.execute(approval.toolName, approval.args, { ...context, ...eventContext, executionMode });
    await this.ctx.agentEvents?.audit("tool.approval_approved", "tool", approval.toolName, { approvalId: id, waitMs }, eventContext);
    return { status: "completed", approval, result };
  }
}
