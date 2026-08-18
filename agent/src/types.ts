export type ExecutionMode = "request_approval" | "approve_high_risk" | "full_access";
export type AgentPolicySettings = {
  executionMode: ExecutionMode;
  allowedCapabilities: string[];
};
export type ToolRisk = "read" | "low" | "medium" | "high" | "critical";

export type ToolContext = {
  userId?: string;
  libraryId?: string;
  sessionCookie?: string;
  executionMode: ExecutionMode;
};

export type AgentTool = {
  name: string;
  description: string;
  risk: ToolRisk;
  capabilities: string[];
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown>;
};

export type Approval = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  userId?: string;
  risk: ToolRisk;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  decidedAt?: string;
};
