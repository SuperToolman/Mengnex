// The session cookie is host-only: localhost and 127.0.0.1 do not share it.
// Keep the Agent Gateway on the browser's current host unless deployment overrides it.
const AGENT_BASE_URL = process.env.NEXT_PUBLIC_AGENT_BASE_URL
    ?? (typeof window === "undefined" ? "http://localhost:7590" : `${window.location.protocol}//${window.location.hostname}:7590`);

export type AgentPlugin = {
    id: string;
    name: string;
    version: string;
    description: string;
    kind: "runtime" | "model" | "tool" | "storage" | "loop" | "skill" | "sandbox" | "scheduler" | "ui" | "integration";
    dependencies: string[];
    provides: string[];
    slots?: string[];
    permissions: string[];
    origin: "builtin" | "local";
    required?: boolean;
    configurable: boolean;
    enabled: boolean;
    active: boolean;
    hasClientModule: boolean;
    installedVersion: string;
    availableVersion: string;
    updateAvailable: boolean;
    revisions: AgentPluginRevision[];
    config: Record<string, unknown>;
    configSchema?: AgentPluginConfigSchema;
    ui?: AgentPluginUiContribution;
};

export type AgentPluginRevision = {
    id: string;
    version: string;
    enabled: boolean;
    config: Record<string, unknown>;
    createdAt: string;
};

export type AgentPluginConfigField = {
    type: "string" | "number" | "boolean" | "array" | "object";
    title: string;
    description?: string;
    default?: unknown;
    enum?: string[];
    format?: "password" | "path" | "textarea";
    properties?: Record<string, AgentPluginConfigField>;
    required?: string[];
    items?: AgentPluginConfigField;
};

export type AgentPluginConfigSchema = {
    type: "object";
    title?: string;
    description?: string;
    properties: Record<string, AgentPluginConfigField>;
    required?: string[];
    additionalProperties?: boolean;
};

export type AgentPluginUiContribution = {
    settings: { label: string; description: string; icon?: string };
};

export type AgentPluginSettingsContribution = {
    pluginId: string;
    schema?: AgentPluginConfigSchema;
    ui: AgentPluginUiContribution["settings"];
    hasClientModule: boolean;
};

async function request<T>(path: string, init?: RequestInit) {
    const response = await fetch(`${AGENT_BASE_URL}${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message ?? "Agent Gateway 请求失败");
    return payload as T;
}

export function getAgentPlugins() {
    return request<{ plugins: AgentPlugin[] }>("/v1/plugins");
}

export function getAgentPluginSettings() {
    return request<{ settings: AgentPluginSettingsContribution[] }>("/v1/plugin-settings");
}

export async function getAgentPluginClient(id: string) {
    const response = await fetch(`${AGENT_BASE_URL}/v1/plugins/${id}/client`, { credentials: "include" });
    if (!response.ok) throw new Error("无法加载插件浏览器模块");
    return response.text();
}

export function invokeAgentPluginAction<T>(pluginId: string, action: string, input: Record<string, unknown> = {}) {
    return request<T>(`/v1/plugins/${pluginId}/actions/${action}`, { method: "POST", body: JSON.stringify(input) });
}

export type AgentModelProvider = {
    id: string;
    name: string;
    provider: "openai_compatible";
    baseUrl: string;
    model: string;
    enabled: boolean;
    isDefault: boolean;
    hasApiKey: boolean;
    createdAt: string;
    updatedAt: string;
};

export type AgentModelProviderInput = {
    name?: string;
    baseUrl?: string;
    model?: string;
    enabled?: boolean;
    isDefault?: boolean;
    apiKey?: string;
    clearApiKey?: boolean;
};

const modelProviderPluginId = "openai-compatible-provider";

export function getAgentModelProviders() {
    return invokeAgentPluginAction<{ providers: AgentModelProvider[] }>(modelProviderPluginId, "list");
}

export function createAgentModelProvider(input: AgentModelProviderInput) {
    return invokeAgentPluginAction<AgentModelProvider>(modelProviderPluginId, "create", {
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
        enabled: input.enabled,
        is_default: input.isDefault,
        api_key: input.apiKey,
    });
}

export function updateAgentModelProvider(id: string, input: AgentModelProviderInput) {
    return invokeAgentPluginAction<AgentModelProvider>(modelProviderPluginId, "update", {
        id,
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
        enabled: input.enabled,
        is_default: input.isDefault,
        api_key: input.apiKey,
        clear_api_key: input.clearApiKey,
    });
}

export function setDefaultAgentModelProvider(id: string) {
    return invokeAgentPluginAction<AgentModelProvider>(modelProviderPluginId, "set-default", { id });
}

export function deleteAgentModelProvider(id: string) {
    return invokeAgentPluginAction<void>(modelProviderPluginId, "delete", { id });
}

export function updateAgentPlugin(id: string, input: { enabled: boolean; config?: Record<string, unknown> }) {
    return request<AgentPlugin>(`/v1/plugins/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
}

export function updateAgentPluginPackage(id: string) {
    return request<AgentPlugin>(`/v1/plugins/${id}/update`, { method: "POST", body: "{}" });
}

export function rollbackAgentPlugin(id: string, revisionId: string) {
    return request<AgentPlugin>(`/v1/plugins/${id}/rollback/${revisionId}`, { method: "POST", body: "{}" });
}

export type AgentChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AgentSession = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: AgentChatMessage[];
};

export type AgentApproval = {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    risk: "read" | "low" | "medium" | "high" | "critical";
    status: "pending" | "approved" | "rejected" | "expired";
    createdAt: string;
};

export type AgentChatResponse = {
    status: "completed" | "approval_required";
    content: string;
    model: string;
    approval?: AgentApproval;
    sessionId?: string;
};

export function getAgentSessions() {
    return request<{ sessions: AgentSession[] }>("/v1/sessions");
}

export function createAgentSession(title?: string) {
    return request<AgentSession>("/v1/sessions", { method: "POST", body: JSON.stringify({ title }) });
}

export function sendAgentSessionMessage(sessionId: string, content: string) {
    return request<AgentChatResponse>(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
    });
}

export async function completeAgentChat(messages: AgentChatMessage[]) {
    return request<AgentChatResponse>("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ messages }),
    });
}

export function decideAgentApproval(id: string, decision: "approve" | "reject") {
    return request<{ status: "completed" | "rejected"; approval: AgentApproval; result?: unknown }>(`/v1/approvals/${id}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
    });
}
