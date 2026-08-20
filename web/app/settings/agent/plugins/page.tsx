"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SettingsPage from "../../components/SettingsPage";
import PluginCard from "./PluginCard";
import { getAgentPlugins, updateAgentPlugin, updateAgentPluginPackage, type AgentPlugin } from "@/src/features/agent/api";

export default function AgentPluginsPage() {
    const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [workingId, setWorkingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => { void getAgentPlugins().then(({ plugins: value }) => setPlugins(value)).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取插件列表")).finally(() => setLoading(false)); }, []);

    function replace(plugin: AgentPlugin) { setPlugins((current) => current.map((entry) => entry.id === plugin.id ? plugin : entry)); }

    async function toggle(plugin: AgentPlugin) {
        setWorkingId(plugin.id); setError(null);
        try { replace(await updateAgentPlugin(plugin.id, { enabled: !plugin.enabled, config: plugin.config })); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "更新插件状态失败"); } finally { setWorkingId(null); }
    }

    async function update(plugin: AgentPlugin) {
        setWorkingId(plugin.id); setError(null);
        try { replace(await updateAgentPluginPackage(plugin.id)); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "更新插件包失败"); }
        finally { setWorkingId(null); }
    }

    return <SettingsPage group="Agent" title="插件" description="管理 Agent 已发现的受信任插件包。启用会挂载 Cordis 插件，停用会卸载运行时服务；不会删除本地插件文件。" contentClassName="max-w-none">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        {loading ? <p className="text-sm text-muted">正在加载插件...</p> : null}
        {!loading ? <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">{plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} working={workingId === plugin.id} onToggle={() => void toggle(plugin)} onUpdate={() => void update(plugin)} onConfigure={() => router.push(`/settings/agent/extensions/${plugin.id}`)} />)}</div> : null}
    </SettingsPage>;
}
