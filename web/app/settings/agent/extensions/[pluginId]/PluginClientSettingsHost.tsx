"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as React from "react";
import { Button, Card, Input, Label, Switch, TextField } from "@heroui/react";
import { getAgentPluginClient, invokeAgentPluginAction, type AgentPlugin } from "@/src/features/agent/api";

type PluginView = React.ReactNode | (() => React.ReactNode);
type ExtensionModule = { register: (context: { registerSettingsView: (render: () => PluginView | Promise<PluginView>) => void; action: <T>(name: string, input?: Record<string, unknown>) => Promise<T>; ui: PluginUiRuntime }) => void | Promise<void> };

export type PluginUiRuntime = {
    React: typeof React;
    components: { Button: typeof Button; Card: typeof Card; Input: typeof Input; Label: typeof Label; Switch: typeof Switch; TextField: typeof TextField };
};

const ui: PluginUiRuntime = { React, components: { Button, Card, Input, Label, Switch, TextField } };

export default function PluginClientSettingsHost({ plugin }: { plugin: AgentPlugin }) {
    const root = useRef<HTMLDivElement>(null);
    const reactRoot = useRef<Root | null>(null);
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
                    ui,
                    registerSettingsView: async (render) => {
                        if (!root.current) return;
                        const view = await render();
                        const node = typeof view === "function" ? view() : view;
                        reactRoot.current = createRoot(root.current);
                        reactRoot.current.render(node);
                        dispose = () => { reactRoot.current?.unmount(); reactRoot.current = null; };
                    },
                });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "插件界面加载失败"); }
        })();
        return () => { dispose?.(); if (url) URL.revokeObjectURL(url); };
    }, [plugin.id]);
    return <>{error ? <p className="text-sm text-danger">{error}</p> : null}<div ref={root} /></>;
}
