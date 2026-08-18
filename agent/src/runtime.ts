import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentTool, Approval, ExecutionMode, ToolContext } from "./types.js";
import type { ExecutionPolicy } from "./execution-policy.js";
import { requiresApproval } from "./policy.js";

declare module "cordis" {
  interface Context {
    agent: AgentRuntime;
  }
}

export class AgentRuntime extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly policy?: ExecutionPolicy;
  private readonly fallback?: { executionMode: ExecutionMode; capabilities: Set<string> };

  constructor(ctx: Context, options?: ExecutionPolicy | { policy?: ExecutionPolicy; fallback?: { executionMode: ExecutionMode; capabilities: Set<string> } } | { executionMode: ExecutionMode; capabilities: Set<string> }) {
    super(ctx, "agent");
    if (options && "view" in options) this.policy = options;
    else if (options && "executionMode" in options) {
      this.fallback = options;
    } else {
      this.policy = options?.policy;
      this.fallback = options?.fallback;
    }
  }

  listTools() { return this.ctx.tools.list(); }

  async invoke(toolName: string, args: Record<string, unknown>, context: Omit<ToolContext, "executionMode"> = {}) {
    const tool = this.ctx.tools.get(toolName);
    if (!tool) throw new Error(`unknown agent tool: ${toolName}`);
    const policy = this.policy?.view() ?? { executionMode: this.fallback?.executionMode ?? "approve_high_risk", allowedCapabilities: [...(this.fallback?.capabilities ?? [])] };
    const missing = tool.capabilities.filter((capability) => !policy.allowedCapabilities.includes(capability));
    if (missing.length) throw new Error(`capability denied: ${missing.join(", ")}`);
    const toolContext = { ...context, executionMode: policy.executionMode };
    if (requiresApproval(policy.executionMode, tool.risk)) {
      const id = crypto.randomUUID();
      const approval: Approval = { id, toolName, args, userId: context.userId, risk: tool.risk, status: "pending", createdAt: new Date().toISOString() };
      return { status: "approval_required", approval: await this.ctx.approvals.create(approval) };
    }
    return { status: "completed", result: await this.ctx.tools.execute(toolName, args, toolContext) };
  }

  async decideApproval(id: string, decision: "approve" | "reject", context: Omit<ToolContext, "executionMode"> = {}) {
    const approval = this.ctx.approvals.getPending(id);
    if (!approval) throw new Error("approval is not pending");
    if (approval.userId && context.userId && approval.userId !== context.userId) throw new Error("approval belongs to another user");
    approval.status = decision === "approve" ? "approved" : "rejected";
    approval.decidedAt = new Date().toISOString();
    if (decision === "reject") {
      await this.ctx.approvals.save();
      return { status: "rejected", approval };
    }
    await this.ctx.approvals.save();
    const executionMode = this.policy?.view().executionMode ?? this.fallback?.executionMode ?? "approve_high_risk";
    const result = await this.ctx.tools.execute(approval.toolName, approval.args, { ...context, executionMode });
    return { status: "completed", approval, result };
  }
}
