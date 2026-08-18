import type { ExecutionMode, ToolRisk } from "./types.js";

export function requiresApproval(mode: ExecutionMode, risk: ToolRisk): boolean {
  if (risk === "critical") return true;
  if (mode === "request_approval") return true;
  if (mode === "approve_high_risk") return risk === "high";
  return false;
}

export function parseExecutionMode(value: string | undefined): ExecutionMode {
  if (value === "request_approval" || value === "full_access") return value;
  return "approve_high_risk";
}

export function parseCapabilities(value: string | undefined): Set<string> {
  return new Set((value ?? "media.search,tasks.read").split(",").map((item) => item.trim()).filter(Boolean));
}
