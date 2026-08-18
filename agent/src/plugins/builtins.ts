import type { Context } from "cordis";
import { parseCapabilities, parseExecutionMode } from "../policy.js";
import { FileExecutionPolicy } from "../execution-policy.js";
import { AgentContextService } from "../agent-context.js";
import { ApprovalService } from "../approvals.js";
import { AgentLoopService } from "../agent-loop.js";
import { LlmProviderService } from "../llm.js";
import { AgentRuntime } from "../runtime.js";
import { PluginApiService } from "../plugin-api.js";
import { AgentEventService } from "../events.js";
import { FileKeyValueStorage, LocalJobScheduler, LocalSandboxProvider } from "../capabilities.js";
import { SessionStore } from "../sessions.js";
import { FileProviderRegistry } from "../providers.js";
import { join } from "node:path";
import { RustApiClient, RustApiService } from "../rust-api.js";
import { ToolRegistry, createCoreToolsPlugin } from "../tools.js";
import type { PluginDefinition } from "../plugin-manager.js";

type Fiber = { dispose: () => Promise<void> };

const rootContext = (ctx: Context) => (ctx as any).root as Context;
const install = async (ctx: Context, plugin: unknown, config?: unknown) => await ((ctx as any).plugin(plugin, config) as PromiseLike<Fiber>);
const disposeAll = (fibers: Fiber[]) => async () => {
  for (const fiber of fibers.reverse()) await fiber.dispose();
};

export function builtInPlugins(api: RustApiClient): PluginDefinition[] {
  return [
    {
      id: "agent-runtime",
      name: "Agent Runtime",
      version: "0.1.0",
      description: "工具注册、能力策略和审批执行的基础运行时。",
      kind: "runtime",
      dependencies: ["file-storage"],
      provides: ["tools", "approvals", "events", "pluginApi", "rustApi"],
      slots: ["runtime"],
      permissions: ["rust-api"],
      origin: "builtin",
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-agent-runtime",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const fibers = [await install(root, RustApiService), await install(root, ToolRegistry), await install(root, ApprovalService), await install(root, PluginApiService), await install(root, AgentEventService)];
          await root.approvals.load();
          return disposeAll(fibers);
        },
      }),
    },
    {
      id: "file-storage",
      name: "File Storage",
      version: "0.1.0",
      description: "本地会话存储。可由数据库会话存储插件替换。",
      kind: "storage",
      dependencies: [],
      provides: ["storage", "sessions"],
      slots: ["storage"],
      permissions: ["local-storage"],
      origin: "builtin",
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-file-storage",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const fibers = [await install(root, FileKeyValueStorage), await install(root, SessionStore)];
          await root.sessions.load();
          return disposeAll(fibers);
        },
      }),
    },
    {
      id: "local-jobs", name: "Local Jobs", version: "0.1.0", description: "进程内调度器实现，可由持久化任务插件替换。", kind: "scheduler", dependencies: ["agent-runtime"], provides: ["jobs"], slots: ["jobs"], permissions: [], origin: "builtin", configurable: false,
      create: () => ({ name: "mengnex-local-jobs", apply: async (ctx: Context) => disposeAll([await install(rootContext(ctx), LocalJobScheduler)]) }),
    },
    {
      id: "local-sandbox", name: "Local Sandbox", version: "0.1.0", description: "本地沙盒能力接缝实现，可由容器或远程沙盒插件替换。", kind: "sandbox", dependencies: ["agent-runtime"], provides: ["sandbox"], slots: ["sandbox"], permissions: [], origin: "builtin", configurable: false,
      create: () => ({ name: "mengnex-local-sandbox", apply: async (ctx: Context) => disposeAll([await install(rootContext(ctx), LocalSandboxProvider)]) }),
    },
    {
      id: "openai-compatible-provider",
      name: "OpenAI Compatible Provider",
      version: "0.1.0",
      description: "使用 OpenAI Chat Completions 协议的模型适配器。",
      kind: "model",
      dependencies: ["agent-runtime"],
      provides: ["llm"],
      permissions: ["network:model-provider"],
      origin: "builtin",
      configurable: true,
      slots: ["model"],
      ui: { settings: { label: "模型供应商", description: "管理 OpenAI Chat Completions 兼容模型连接。", icon: "model" } },
      client: { entryPath: join(process.cwd(), "client-plugins", "model-provider.js") },
      create: () => ({
        name: "mengnex-openai-compatible-provider",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const provider = await install(root, FileProviderRegistry);
          await root.providers.load();
          const cleanups = [root.pluginApi.register("openai-compatible-provider", "list", () => ({ providers: root.providers.list() })), root.pluginApi.register("openai-compatible-provider", "create", (input) => root.providers.create({ name: stringValue(input.name), baseUrl: stringValue(input.base_url), model: stringValue(input.model), enabled: booleanValue(input.enabled), isDefault: input.is_default === true, apiKey: stringValue(input.api_key) })), root.pluginApi.register("openai-compatible-provider", "update", (input) => root.providers.update(String(input.id ?? ""), { name: stringValue(input.name), baseUrl: stringValue(input.base_url), model: stringValue(input.model), enabled: booleanValue(input.enabled), isDefault: typeof input.is_default === "boolean" ? input.is_default : undefined, apiKey: stringValue(input.api_key), clearApiKey: input.clear_api_key === true })), root.pluginApi.register("openai-compatible-provider", "delete", (input) => root.providers.delete(String(input.id ?? ""))), root.pluginApi.register("openai-compatible-provider", "set-default", (input) => root.providers.setDefault(String(input.id ?? "")))];
          return disposeAll([provider, await install(root, LlmProviderService, root.providers), { dispose: async () => cleanups.reverse().forEach((cleanup) => cleanup()) }]);
        },
      }),
    },
    {
      id: "execution-policy",
      name: "Execution Policy",
      version: "0.1.0",
      description: "审批模式和 Agent 能力许可的策略插件。",
      kind: "integration",
      dependencies: ["agent-runtime"],
      provides: ["execution.policy", "policy", "agent"],
      permissions: [],
      origin: "builtin",
      required: true,
      configurable: true,
      ui: { settings: { label: "执行策略", description: "控制批准模式和允许 Agent 调用的能力。", icon: "shield" } },
      client: { entryPath: join(process.cwd(), "client-plugins", "execution-policy.js") },
      create: () => ({
        name: "mengnex-execution-policy",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const policy = await install(root, FileExecutionPolicy);
          await root.policy.load();
          const runtime = await install(root, AgentRuntime, { policy: root.policy, fallback: { executionMode: parseExecutionMode(process.env.AGENT_EXECUTION_MODE), capabilities: parseCapabilities(process.env.AGENT_ALLOWED_CAPABILITIES) } });
          const cleanups = [root.pluginApi.register("execution-policy", "get", () => root.policy.view()), root.pluginApi.register("execution-policy", "update", (input) => root.policy.update({ executionMode: stringValue(input.execution_mode) as any, allowedCapabilities: Array.isArray(input.allowed_capabilities) ? input.allowed_capabilities.filter((value): value is string => typeof value === "string") : undefined }))];
          return disposeAll([policy, runtime, { dispose: async () => cleanups.reverse().forEach((cleanup) => cleanup()) }]);
        },
      }),
    },
    {
      id: "agent-loop",
      name: "Agent Loop",
      version: "0.1.0",
      description: "模型推理、工具调用和审批中断的受控循环。",
      kind: "loop",
      dependencies: ["agent-runtime", "execution-policy"],
      provides: ["agentLoop"],
      slots: ["loop"],
      permissions: [],
      origin: "builtin",
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-agent-loop",
        apply: async (ctx: Context) => disposeAll([await install(rootContext(ctx), AgentContextService), await install(rootContext(ctx), AgentLoopService)]),
      }),
    },
    {
      id: "core-tools",
      name: "Core Tools",
      version: "0.1.0",
      description: "媒体搜索、任务和外部媒体导入工具。",
      kind: "tool",
      dependencies: ["agent-runtime"],
      provides: ["media.search", "tasks.read", "tasks.create", "media.import"],
      slots: ["core-tools"],
      permissions: ["rust-api"],
      origin: "builtin",
      required: true,
      configurable: false,
      create: () => createCoreToolsPlugin(api),
    },
  ];
}

function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function booleanValue(value: unknown) { return typeof value === "boolean" ? value : undefined; }
