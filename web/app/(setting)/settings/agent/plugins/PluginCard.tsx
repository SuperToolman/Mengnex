"use client";

import { Check, Puzzle } from "@gravity-ui/icons";
import { Button, Card } from "@heroui/react";
import type { AgentPlugin } from "@/src/features/agent/api";

type PluginCardProps = {
    plugin: AgentPlugin;
    working: boolean;
    onToggle: () => void;
    onConfigure: () => void;
    onUpdate: () => void;
};

export default function PluginCard({ plugin, working, onToggle, onConfigure, onUpdate }: PluginCardProps) {
    return <Card.Root className="h-full">
        <Card.Content className="flex h-full flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Puzzle className="h-5 w-5" /></div><div className="min-w-0"><h2 className="truncate font-semibold">{plugin.name}</h2><p className="mt-1 text-xs text-muted">v{plugin.version} · {plugin.kind}</p></div></div>
                {plugin.required ? <span className="shrink-0 rounded bg-default px-2 py-1 text-xs text-muted">核心</span> : null}
            </div>
            <div className="flex flex-wrap gap-2 text-xs"><span className={`inline-flex items-center gap-1 rounded px-2 py-1 ${plugin.active ? "bg-success/15 text-success" : "bg-default text-muted"}`}>{plugin.active ? <Check className="h-3.5 w-3.5" /> : null}{plugin.active ? "运行中" : "已停用"}</span><span className="rounded bg-default px-2 py-1 text-muted">{plugin.origin === "builtin" ? "内置包" : "本地包"}</span><span className="rounded bg-default px-2 py-1 text-muted">已装 v{plugin.installedVersion}</span></div>
            <p className="line-clamp-3 min-h-15 text-sm leading-6 text-muted">{plugin.description}</p>
            <dl className="mt-auto space-y-2 border-t border-border pt-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted">提供能力</dt><dd className="truncate text-right">{plugin.provides.slice(0, 2).join("、") || "无"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">依赖</dt><dd className="truncate text-right">{plugin.dependencies.length ? plugin.dependencies.join("、") : "无"}</dd></div></dl>
            <div className="flex gap-2"><Button className="flex-1" size="sm" variant="secondary" isDisabled={working || plugin.required} onPress={onToggle}>{plugin.active ? "停用" : "启用"}</Button>{plugin.updateAvailable ? <Button size="sm" variant="secondary" isDisabled={working} onPress={onUpdate}>更新</Button> : null}{plugin.ui?.settings ? <Button size="sm" variant="secondary" isDisabled={working} onPress={onConfigure}>设置</Button> : null}</div>
        </Card.Content>
    </Card.Root>;
}
