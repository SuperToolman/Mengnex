import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ProviderRegistry, ProviderSettings } from "./providers.js";
import type { CredentialProvider } from "./credentials.js";
import type { LlmAdapterRegistry } from "./llm-adapters-registry.js";
import type { ModelSelectionService } from "./model-selection.js";
import type { LlmDelta } from "./llm-adapters.js";
import type { ToolContext } from "./types.js";

export type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string | null; reasoning_content?: string; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

declare module "cordis" {
  interface Context {
    llm: LlmProviderService;
  }
}

export class LlmProviderService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly providers: ProviderRegistry;
  private readonly credentials: CredentialProvider;
  private readonly adapters: LlmAdapterRegistry;
  private readonly selection: ModelSelectionService;
  constructor(ctx: Context, config: { providers: ProviderRegistry; credentials: CredentialProvider; adapters: LlmAdapterRegistry; selection: ModelSelectionService }) {
    super(ctx, "llm");
    this.providers = config.providers; this.credentials = config.credentials; this.adapters = config.adapters; this.selection = config.selection;
  }

  async complete(messages: ChatMessage[], tools: ChatTool[] = [], options: { signal?: AbortSignal; profile?: string; context?: Omit<ToolContext, "executionMode"> } = {}) {
    const selection = this.selection.resolve(options.profile);
    const provider = this.providers.resolve(selection?.providerId);
    const selected = await this.resolveProvider(provider, selection?.model);
    return this.measure(selected, messages, tools, options, () => this.adapters.complete(selected, messages, tools, options));
  }

  async *stream(messages: ChatMessage[], tools: ChatTool[] = [], options: { signal?: AbortSignal; profile?: string; context?: Omit<ToolContext, "executionMode"> } = {}): AsyncIterable<LlmDelta> {
    const selection = this.selection.resolve(options.profile);
    const provider = this.providers.resolve(selection?.providerId);
    const selected = await this.resolveProvider(provider, selection?.model);
    const startedAt = performance.now(); const context = { correlationId: options.context?.correlationId ?? crypto.randomUUID(), sessionId: options.context?.sessionId, turnId: options.context?.turnId, actorId: options.context?.actorId ?? options.context?.userId, parentJobId: options.context?.parentJobId, parentSubagentId: options.context?.parentSubagentId };
    try {
      for await (const delta of this.adapters.stream(selected, messages, tools, options)) yield delta;
      await this.ctx.agentEvents?.emit("llm:completed", { providerId: selected.id, model: selected.model, ...(options.profile ? { profile: options.profile } : {}), durationMs: performance.now() - startedAt, outcome: "completed" }, "llm", context);
    } catch (error) {
      const classified = classifyLlmError(error);
      await this.ctx.agentEvents?.emit("llm:failed", { providerId: selected.id, model: selected.model, ...(options.profile ? { profile: options.profile } : {}), durationMs: performance.now() - startedAt, outcome: "failed", error: classified }, "llm", context);
      throw error;
    }
  }
  async resolveForAdapter(providerId?: string, model?: string) { const provider = this.providers.resolve(providerId); return this.resolveProvider(provider, model); }
  private async resolveProvider(provider: ProviderSettings, model?: string) { if (!provider.credentialId) throw new Error("model provider credential is not configured"); const apiKey = await this.credentials.resolve(provider.credentialId, "model-provider"); return { ...provider, ...(model ? { model } : {}), apiKey }; }
  private async measure<T>(selected: ProviderSettings & { apiKey: string }, messages: ChatMessage[], tools: ChatTool[], options: { signal?: AbortSignal; profile?: string; context?: Omit<ToolContext, "executionMode"> }, execute: () => Promise<T>) {
    const startedAt = performance.now(); const context = { correlationId: options.context?.correlationId ?? crypto.randomUUID(), sessionId: options.context?.sessionId, turnId: options.context?.turnId, actorId: options.context?.actorId ?? options.context?.userId, parentJobId: options.context?.parentJobId, parentSubagentId: options.context?.parentSubagentId };
    try { const result = await execute(); await this.ctx.agentEvents?.emit("llm:completed", { providerId: selected.id, model: selected.model, ...(options.profile ? { profile: options.profile } : {}), durationMs: performance.now() - startedAt, outcome: "completed" }, "llm", context); return result; }
    catch (error) { await this.ctx.agentEvents?.emit("llm:failed", { providerId: selected.id, model: selected.model, ...(options.profile ? { profile: options.profile } : {}), durationMs: performance.now() - startedAt, outcome: "failed", error: classifyLlmError(error) }, "llm", context); throw error; }
  }
}

function classifyLlmError(error: unknown) { const message = error instanceof Error ? error.message : "model request failed"; if (error instanceof DOMException && error.name === "AbortError") return { code: "LLM_CANCELLED", message, retryable: false }; if (/disabled|not configured/i.test(message)) return { code: "LLM_CONFIGURATION", message, retryable: false }; if (/timeout|network|fetch|5\d\d/i.test(message)) return { code: "LLM_TRANSIENT", message, retryable: true }; return { code: "LLM_REQUEST_FAILED", message, retryable: false }; }
