import type { Context } from "cordis";
import { FileExecutionPolicy } from "../execution-policy.js";
import { AgentContextService } from "../agent-context.js";
import { ApprovalService } from "../approvals.js";
import { AgentLoopService } from "../agent-loop.js";
import { LlmProviderService } from "../llm.js";
import { AgentRuntime } from "../runtime.js";
import { PluginApiService } from "../plugin-api.js";
import { AgentEventService } from "../events.js";
import { PersistentJobScheduler, LocalProcessSandbox } from "../capabilities.js";
import { SessionStore } from "../sessions.js";
import { FileProviderRegistry } from "../providers.js";
import { FileCredentialProvider } from "../credentials.js";
import { FileSettingsProvider } from "../settings.js";
import { FileModelSelection } from "../model-selection.js";
import { DefaultLlmAdapterRegistry } from "../llm-adapters-registry.js";
import { createOpenAiCompatibleAdapter } from "../llm-adapters.js";
import { join } from "node:path";
import { RustApiClient, RustApiService } from "../rust-api.js";
import { createRustMediaCapabilitiesPlugin } from "../media-capabilities.js";
import { createWebCapabilitiesPlugin } from "../web-capabilities.js";
import { ToolRegistry, createCoreToolsPlugin, createWebToolsPlugin } from "../tools.js";
import { DefaultAgentGatewayFacade } from "../gateway.js";
import { DefaultConversationGateway } from "../gateway-conversation.js";
import { DefaultAdministrationGateway } from "../gateway-administration.js";
import { DefaultObservabilityGateway } from "../gateway-observability.js";
import type { PluginDefinition } from "../plugin-manager.js";

type Fiber = { dispose: () => Promise<void> };

const rootContext = (ctx: Context) => (ctx as any).root as Context;
const install = async (ctx: Context, plugin: unknown, config?: unknown) => await ((ctx as any).plugin(plugin, config) as PromiseLike<Fiber>);
const disposeAll = (fibers: Fiber[]) => async () => {
  for (const fiber of fibers.reverse()) await fiber.dispose();
};

export function corePluginDefinitions(api: RustApiClient): PluginDefinition[] {
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
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-agent-runtime",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const fibers = [await install(root, RustApiService), await install(root, ToolRegistry), await install(root, ApprovalService), await install(root, PluginApiService), await install(root, AgentEventService)];
          await root.approvals.load();
          await root.agentEvents.load();
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
      provides: ["storage", "sessions", "settings", "credentials", "modelSelection"],
      slots: ["storage"],
      permissions: ["local-storage"],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-file-storage",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const fibers = [await install(root, SessionStore), await install(root, FileSettingsProvider), await install(root, FileCredentialProvider), await install(root, FileModelSelection, root.settings)];
          await root.sessions.load();
          await root.settings.load();
          await root.credentials.load();
          await root.modelSelection.load();
          return disposeAll(fibers);
        },
      }),
    },
    {
      id: "local-jobs", name: "Persistent Local Scheduler", version: "0.2.0", description: "带持久化计划、重试和运行历史的单进程调度器，可由远程调度插件替换。", kind: "scheduler", dependencies: ["agent-runtime"], provides: ["jobs", "scheduler.history"], slots: ["jobs"], permissions: ["local-storage"], origin: "builtin", defaultEnabled: true, configurable: false,
      create: () => ({ name: "mengnex-persistent-local-jobs", apply: async (ctx: Context) => { const root = rootContext(ctx); const scheduler = await install(root, PersistentJobScheduler); await root.jobs.load(); await root.jobs.start(); return disposeAll([scheduler]); } }),
    },
    {
      id: "local-sandbox", name: "Local Process Sandbox", version: "0.2.0", description: "无 shell、独立工作目录、输出上限和超时的本地进程沙盒；容器或远程沙盒可替换该 slot。", kind: "sandbox", dependencies: ["agent-runtime"], provides: ["sandbox", "sandbox.process"], slots: ["sandbox"], permissions: ["process:spawn", "local-storage"], origin: "builtin", defaultEnabled: true, configurable: false,
      create: () => ({ name: "mengnex-local-process-sandbox", apply: async (ctx: Context) => disposeAll([await install(rootContext(ctx), LocalProcessSandbox)]) }),
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
      defaultEnabled: true,
      configurable: true,
      slots: ["model"],
      ui: { settings: { label: "模型供应商", description: "管理 OpenAI Chat Completions 兼容模型连接。", icon: "model" } },
      client: { entryPath: join(process.cwd(), "client-plugins", "model-provider.js") },
      create: () => ({
        name: "mengnex-openai-compatible-provider",
        apply: async (ctx: Context) => {
          const root = rootContext(ctx);
          const adapters = await install(root, DefaultLlmAdapterRegistry);
          root.llmAdapters.register(createOpenAiCompatibleAdapter());
          const provider = await install(root, FileProviderRegistry, { credentials: root.credentials, events: root.agentEvents });
          await root.providers.load();
          const cleanups = [root.pluginApi.register("openai-compatible-provider", "list", () => ({ providers: root.providers.list() })), root.pluginApi.register("openai-compatible-provider", "create", (input) => root.providers.create({ name: stringValue(input.name), baseUrl: stringValue(input.base_url), model: stringValue(input.model), enabled: booleanValue(input.enabled), isDefault: input.is_default === true, apiKey: stringValue(input.api_key) })), root.pluginApi.register("openai-compatible-provider", "update", (input) => root.providers.update(String(input.id ?? ""), { name: stringValue(input.name), baseUrl: stringValue(input.base_url), model: stringValue(input.model), enabled: booleanValue(input.enabled), isDefault: typeof input.is_default === "boolean" ? input.is_default : undefined, apiKey: stringValue(input.api_key), clearApiKey: input.clear_api_key === true })), root.pluginApi.register("openai-compatible-provider", "delete", (input) => root.providers.delete(String(input.id ?? ""))), root.pluginApi.register("openai-compatible-provider", "set-default", (input) => root.providers.setDefault(String(input.id ?? ""))), root.pluginApi.register("openai-compatible-provider", "models", async (input) => root.llmAdapters.models(await root.llm.resolveForAdapter(stringValue(input.id)))), root.pluginApi.register("openai-compatible-provider", "test-connection", async (input) => root.llmAdapters.testConnection(await root.llm.resolveForAdapter(stringValue(input.id)))), root.pluginApi.register("model-selection", "get", (input) => root.modelSelection.resolve(stringValue(input.profile))), root.pluginApi.register("model-selection", "set", (input) => root.modelSelection.set(String(input.profile ?? process.env.AGENT_PROFILE ?? "default"), stringValue(input.provider_id), stringValue(input.model), typeof input.revision === "number" ? input.revision : undefined))];
          return disposeAll([provider, adapters, await install(root, LlmProviderService, { providers: root.providers, credentials: root.credentials, adapters: root.llmAdapters, selection: root.modelSelection }), { dispose: async () => cleanups.reverse().forEach((cleanup) => cleanup()) }]);
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
      defaultEnabled: true,
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
          const runtime = await install(root, AgentRuntime, root.policy);
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
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => ({
        name: "mengnex-agent-loop",
        apply: async (ctx: Context) => disposeAll([await install(rootContext(ctx), AgentContextService), await install(rootContext(ctx), AgentLoopService)]),
      }),
    },
    {
      id: "rust-media-capabilities",
      name: "Rust Media Capability Adapter",
      version: "0.1.0",
      description: "将媒体目录、库权限、扫描、任务、元数据和外部导入能力适配到 Mengnex Rust API。",
      kind: "integration",
      dependencies: ["agent-runtime"],
      provides: ["media.catalog", "library.access", "media.scanner", "media.tasks", "media.metadata", "media.external-sources"],
      slots: ["media-capabilities"],
      permissions: ["rust-api"],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => createRustMediaCapabilitiesPlugin(),
    },
    {
      id: "web-capabilities",
      name: "Web Capabilities",
      version: "0.1.0",
      description: "受控访问公开网页并下载 HTTP(S) 资源。",
      kind: "integration",
      dependencies: ["agent-runtime"],
      provides: ["web"],
      slots: ["web-capabilities"],
      permissions: ["network"],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => createWebCapabilitiesPlugin(),
    },
    {
      id: "core-tools",
      name: "Core Tools",
      version: "0.1.0",
      description: "媒体搜索、任务和外部媒体导入工具。",
      kind: "tool",
      dependencies: ["agent-runtime", "rust-media-capabilities", "web-capabilities"],
      provides: ["media.catalog.read", "media.tasks.read", "media.scan.start", "media.external.import"],
      slots: ["core-tools"],
      permissions: ["rust-api"],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => createCoreToolsPlugin(),
    },
    {
      id: "web-tools",
      name: "Web Tools",
      version: "0.1.0",
      description: "将网页访问和资源下载能力暴露给 Agent。",
      kind: "tool",
      dependencies: ["agent-runtime", "web-capabilities"],
      provides: ["web.read", "web.download"],
      slots: ["web-tools"],
      permissions: ["network"],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => createWebToolsPlugin(),
    },
    {
      id: "agent-gateway",
      name: "Agent Gateway Facade",
      version: "0.2.0",
      description: "稳定的会话、聊天、工具和插件管理门面，隔离 HTTP 传输与具体服务实现。",
      kind: "runtime",
      dependencies: ["agent-runtime", "file-storage", "execution-policy", "agent-loop"],
      provides: ["gateway"],
      slots: ["gateway"],
      permissions: [],
      origin: "builtin",
      defaultEnabled: true,
      required: true,
      configurable: false,
      create: () => ({ name: "mengnex-agent-gateway-facade", apply: async (ctx: Context) => { const root = rootContext(ctx); const fibers = [await install(root, DefaultConversationGateway), await install(root, DefaultAdministrationGateway), await install(root, DefaultObservabilityGateway), await install(root, DefaultAgentGatewayFacade)]; return disposeAll(fibers); } }),
    },
  ];
}

function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function booleanValue(value: unknown) { return typeof value === "boolean" ? value : undefined; }
