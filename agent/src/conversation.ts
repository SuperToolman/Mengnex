import type { ToolCallRecord } from "./agent-loop.js";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string };

export type ToolCallBlock = {
  type: "tool-call";
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallRecord["status"];
  result?: unknown;
  approvalId?: string;
  startedAt: string;
  completedAt?: string;
};

export type AssistantBlock = ContentBlock | ToolCallBlock;

export type ConversationTurn = {
  id: string;
  createdAt: string;
  user: { content: ContentBlock[] };
  assistant: {
    content: AssistantBlock[];
    model: string;
    status: "completed" | "approval_required";
  };
};

export function toolCallBlock(record: ToolCallRecord): ToolCallBlock {
  return {
    type: "tool-call",
    callId: record.id,
    name: record.toolName,
    args: record.args,
    status: record.status,
    result: record.result,
    approvalId: record.approvalId,
    startedAt: record.createdAt,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
  };
}
