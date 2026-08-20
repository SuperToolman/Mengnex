"use client";

import { Puzzle } from "@gravity-ui/icons";
import { Badge, Button, Card } from "@heroui/react";
import { useState } from "react";
import type { AgentPlugin } from "@/src/features/agent/api";

type PluginCardProps = {
    plugin: AgentPlugin;
    working: boolean;
    onToggle: () => void;
    onConfigure: () => void;
    onUpdate: () => void;
};

export default function PluginCard({ plugin, working, onToggle, onConfigure, onUpdate }: PluginCardProps) {
    const [expanded, setExpanded] = useState(false);

    return <Card.Root variant="secondary" className="relative border border-[color:var(--surface-component-border)] bg-[var(--surface-component)] shadow-sm transition-shadow hover:shadow-surface">
        <Card.Content className="">
            {plugin.active ? <Badge.Anchor className="absolute right-2 top-2 z-10 size-2"><span aria-hidden="true" className="size-2" /><Badge aria-label="插件运行中" className="scale-75" color="success" size="sm" /></Badge.Anchor> : null}
            <button type="button" className="flex w-full items-start justify-between gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                <span className="flex min-w-0 gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Puzzle className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate font-semibold">{plugin.name}</span><span className="mt-1 block text-xs text-muted">v{plugin.version} · {plugin.kind}</span></span></span>
                <span className="flex shrink-0 items-center gap-2 pr-1">
                    {plugin.required ? <span className="rounded bg-default px-2 py-1 text-xs text-muted">核心</span> : null}
                    <span className={`rounded px-2 py-1 text-xs ${plugin.active ? "bg-success/15 text-success" : "bg-default text-muted"}`}>
                        {plugin.active ? "运行中" : "已停用"}
                    </span>
                </span>
            </button>
            {expanded ? <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                <div className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-default px-2 py-1 text-muted">{plugin.origin === "builtin" ? "内置包" : "本地包"}</span><span className="rounded bg-default px-2 py-1 text-muted">已装 v{plugin.installedVersion}</span></div>
                <p className="text-sm leading-6 text-muted">{plugin.description}</p>
                <dl className="space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted">提供能力</dt><dd className="truncate text-right">{plugin.provides.slice(0, 2).join("、") || "无"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">依赖</dt><dd className="truncate text-right">{plugin.dependencies.length ? plugin.dependencies.join("、") : "无"}</dd></div></dl>
                <div className="flex gap-2"><Button className="flex-1" size="sm" variant="secondary" isDisabled={working || plugin.required} onPress={onToggle}>{plugin.active ? "停用" : "启用"}</Button>{plugin.updateAvailable ? <Button size="sm" variant="secondary" isDisabled={working} onPress={onUpdate}>更新</Button> : null}{plugin.ui?.settings ? <Button size="sm" variant="secondary" isDisabled={working} onPress={onConfigure}>设置</Button> : null}</div>
            </div> : null}
        </Card.Content>
    </Card.Root>;
}
