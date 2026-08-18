import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ProviderRegistry, ProviderSettings } from "./providers.js";

export type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

declare module "cordis" {
  interface Context {
    llm: LlmProviderService;
  }
}

export class LlmProviderService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  constructor(ctx: Context, private readonly providers: ProviderRegistry) {
    super(ctx, "llm");
  }

  complete(messages: ChatMessage[], tools: ChatTool[] = []) {
    return completeChat(this.providers.configured(), messages, tools);
  }
}

async function completeChat(settings: ProviderSettings, messages: ChatMessage[], tools: ChatTool[] = []) {
  if (!settings.enabled) throw new Error("model provider is disabled");
  if (!settings.apiKey) throw new Error("model provider API key is not configured");
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, messages, temperature: 0.4, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
  });
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `model provider request failed (${response.status})`);
  const message = payload.choices?.[0]?.message;
  if (!message || (!message.content && !message.tool_calls?.length)) throw new Error("model provider returned no assistant message");
  return { content: message.content ?? "", tool_calls: message.tool_calls ?? [], model: settings.model };
}
