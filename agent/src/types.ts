export type ExecutionMode = "request_approval" | "approve_high_risk" | "full_access";
export type AgentPolicySettings = {
  executionMode?: ExecutionMode;
  allowedCapabilities: string[];
};
export type ToolRisk = "read" | "low" | "medium" | "high" | "critical";

export type ToolContext = {
  userId?: string;
  actorId?: string;
  libraryId?: string;
  sessionCookie?: string;
  executionMode: ExecutionMode;
  correlationId?: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  pluginId?: string;
  parentJobId?: string;
  parentSubagentId?: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export type ToolPresentation = { label?: string; icon?: string; group?: string; confirmation?: string };
export type ToolExecutionState = "created" | "validated" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "replayed";
export type ToolErrorCode = "INVALID_ARGUMENTS" | "TIMEOUT" | "CANCELLED" | "OUTPUT_LIMIT" | "EXECUTION_FAILED" | "IDEMPOTENCY_CONFLICT";
export class StructuredToolError extends Error { readonly name = "StructuredToolError"; constructor(readonly code: ToolErrorCode, message: string, readonly tool: string, readonly details?: Record<string, unknown>) { super(message); } }

export type AgentTool = {
  name: string;
  description: string;
  risk: ToolRisk;
  capabilities: string[];
  inputSchema: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  idempotent?: boolean;
  presentation?: ToolPresentation;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown>;
};

export type Approval = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  userId?: string;
  actorId?: string;
  correlationId?: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  parentJobId?: string;
  risk: ToolRisk;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  decidedAt?: string;
};
