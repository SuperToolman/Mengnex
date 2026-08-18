"use client";

import { useEffect, useRef, useState } from "react";
import { getAgentPluginClient, invokeAgentPluginAction, type AgentPlugin } from "@/src/features/agent/api";

type ExtensionModule = { register: (context: { registerSettingsView: (render: (root: HTMLElement) => void | (() => void) | Promise<void | (() => void)>) => void; action: <T>(name: string, input?: Record<string, unknown>) => Promise<T> }) => void | Promise<void> };

export default function PluginClientSettingsHost({ plugin }: { plugin: AgentPlugin }) {
    const root = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let dispose: undefined | (() => void);
        let url: string | undefined;
        void (async () => {
            try {
                const source = await getAgentPluginClient(plugin.id);
                url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
                const pluginModule = await import(/* webpackIgnore: true */ url) as ExtensionModule;
                if (typeof pluginModule.register !== "function" || !root.current) throw new Error("插件客户端模块未导出 register()。");
                await pluginModule.register({
                    action: (name, input) => invokeAgentPluginAction(plugin.id, name, input),
                    registerSettingsView: async (render) => { if (root.current) dispose = await render(root.current) ?? undefined; },
                });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "插件界面加载失败"); }
        })();
        return () => { dispose?.(); if (url) URL.revokeObjectURL(url); };
    }, [plugin.id]);
    return <>{error ? <p className="text-sm text-danger">{error}</p> : null}<div ref={root} /></>;
}
