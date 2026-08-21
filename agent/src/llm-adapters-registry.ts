import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ProviderSettings } from "./providers.js";
import { classifyLlmFailure, type LlmAdapter, type LlmCompletion, type LlmDelta, type ResolvedProviderSettings } from "./llm-adapters.js";
import type { ChatMessage, ChatTool } from "./llm.js";

export abstract class LlmAdapterRegistry extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "llmAdapters") { super(ctx, key); }
  abstract register(adapter: LlmAdapter): () => void;
  abstract list(): Array<Pick<LlmAdapter, "id" | "name">>;
  abstract complete(provider: ResolvedProviderSettings, messages: ChatMessage[], tools: ChatTool[], options: { signal?: AbortSignal }): Promise<LlmCompletion>;
  abstract stream(provider: ResolvedProviderSettings, messages: ChatMessage[], tools: ChatTool[], options: { signal?: AbortSignal }): AsyncIterable<LlmDelta>;
  abstract models(provider: ResolvedProviderSettings, options?: { signal?: AbortSignal }): Promise<Array<{ id: string; name: string; contextWindow?: number }>>;
  abstract testConnection(provider: ResolvedProviderSettings, options?: { signal?: AbortSignal }): Promise<{ ok: true; latencyMs: number; model: string }>;
}
declare module "cordis" { interface Context { llmAdapters: LlmAdapterRegistry } }

export class DefaultLlmAdapterRegistry extends LlmAdapterRegistry {
  private readonly adapters = new Map<string, LlmAdapter>();
  constructor(ctx: Context) { super(ctx); }
  register(adapter: LlmAdapter) { if (this.adapters.has(adapter.id)) throw new Error(`LLM adapter already registered: ${adapter.id}`); this.adapters.set(adapter.id, adapter); return () => this.adapters.delete(adapter.id); }
  list() { return [...this.adapters.values()].map(({ id, name }) => ({ id, name })); }
  private adapter(provider: ProviderSettings) { const value = this.adapters.get(provider.provider); if (!value) throw new Error(`LLM adapter not registered: ${provider.provider}`); return value; }
  async complete(provider: ResolvedProviderSettings, messages: ChatMessage[], tools: ChatTool[], options: { signal?: AbortSignal }) { const adapter = this.adapter(provider); let attempt = 0; let last = classifyLlmFailure(new Error("model request failed")); while (attempt < 3) { try { return await adapter.complete(provider, messages, tools, options); } catch (error) { last = classifyLlmFailure(error); if (!last.retryable || attempt === 2) throw last; await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt))); attempt += 1; } } throw last; }
  async *stream(provider: ResolvedProviderSettings, messages: ChatMessage[], tools: ChatTool[], options: { signal?: AbortSignal }) { const adapter = this.adapter(provider); if (adapter.stream) { yield* adapter.stream(provider, messages, tools, options); return; } const result = await this.complete(provider, messages, tools, options); if (result.reasoning) yield { reasoning: result.reasoning, model: result.model }; if (result.content) yield { content: result.content, model: result.model }; for (const [index, call] of result.tool_calls.entries()) yield { toolCall: { index, id: call.id, name: call.function.name, arguments: call.function.arguments }, model: result.model }; }
  models(provider: ResolvedProviderSettings, options: { signal?: AbortSignal } = {}) { return this.adapter(provider).models(provider, options); }
  testConnection(provider: ResolvedProviderSettings, options = {}) { return this.adapter(provider).testConnection(provider, options); }
}
