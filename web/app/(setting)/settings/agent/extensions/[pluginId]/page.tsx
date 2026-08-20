"use client";

import { Button, Card, Input, Label, ListBox, Select, Switch, TextArea, TextField } from "@heroui/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SettingsPage from "../../../components/SettingsPage";
import {
    getAgentPlugins,
    getAgentPluginSettings,
    updateAgentPlugin,
    rollbackAgentPlugin,
    type AgentPlugin,
    type AgentPluginConfigField,
    type AgentPluginConfigSchema,
} from "@/src/features/agent/api";
import PluginClientSettingsHost from "./PluginClientSettingsHost";

type Config = Record<string, unknown>;

export default function PluginSettingsPage() {
    const params = useParams<{ pluginId: string }>();
    const router = useRouter();
    const [plugin, setPlugin] = useState<AgentPlugin | null>(null);
    const [config, setConfig] = useState<Config>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rollingBack, setRollingBack] = useState<string | null>(null);

    useEffect(() => {
        void Promise.all([getAgentPlugins(), getAgentPluginSettings()])
            .then(([{ plugins }, { settings }]) => {
                const current = plugins.find((entry) => entry.id === params.pluginId) ?? null;
                if (!current) throw new Error("未找到该插件");
                const contribution = settings.find((entry) => entry.pluginId === current.id);
                if (!contribution) throw new Error("该插件未提供设置界面");
                const contributed = { ...current, configSchema: contribution.schema, ui: { settings: contribution.ui } };
                setPlugin(contributed);
                setConfig(contribution.schema ? withDefaults(contribution.schema, current.config) : current.config);
            })
            .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取插件设置"))
            .finally(() => setLoading(false));
    }, [params.pluginId]);

    const schema = plugin?.configSchema;
    const title = plugin?.ui?.settings.label ?? plugin?.name ?? "插件设置";
    const description = plugin?.ui?.settings.description ?? plugin?.description ?? "";

    async function save() {
        if (!plugin) return;
        setSaving(true); setError(null);
        try {
            const updated = await updateAgentPlugin(plugin.id, { enabled: plugin.enabled, config });
            setPlugin(updated); if (updated.configSchema) setConfig(withDefaults(updated.configSchema, updated.config));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存插件设置失败");
        } finally { setSaving(false); }
    }

    async function rollback(revisionId: string) {
        if (!plugin) return;
        setRollingBack(revisionId); setError(null);
        try {
            const updated = await rollbackAgentPlugin(plugin.id, revisionId);
            setPlugin(updated);
            setConfig(updated.configSchema ? withDefaults(updated.configSchema, updated.config) : updated.config);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "回滚插件配置失败");
        } finally { setRollingBack(null); }
    }

    return <SettingsPage group="Agent 插件" title={title} description={description} contentClassName="max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" variant="secondary" onPress={() => router.push("/settings/agent/plugins")}>返回插件</Button>
            {plugin ? <span className={`rounded px-2 py-1 text-xs ${plugin.active ? "bg-success/15 text-success" : "bg-default text-muted"}`}>{plugin.active ? "运行中" : "已停用"}</span> : null}
        </div>
        {loading ? <p className="text-sm text-muted">正在加载插件设置...</p> : null}
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        {plugin?.hasClientModule ? <PluginClientSettingsHost plugin={plugin} /> : null}
        {plugin && schema && !plugin.hasClientModule ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            {Object.entries(schema.properties).map(([key, field]) => <ConfigField key={key} field={field} required={schema.required?.includes(key)} value={config[key]} onChange={(value) => setConfig((current) => ({ ...current, [key]: value }))} />)}
            <div className="flex justify-end border-t border-border pt-4"><Button type="submit" isDisabled={saving}>{saving ? "保存中..." : "保存设置"}</Button></div>
        </form> : null}
        {plugin && plugin.revisions.length ? <section className="mt-8 border-t border-border pt-5"><h2 className="text-sm font-medium">历史版本</h2><div className="mt-3 space-y-2">{plugin.revisions.map((revision) => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-xs"><span className="text-muted">v{revision.version} · {new Date(revision.createdAt).toLocaleString()}</span><Button size="sm" variant="secondary" isDisabled={Boolean(rollingBack)} onPress={() => void rollback(revision.id)}>{rollingBack === revision.id ? "回滚中..." : "回滚到此版本"}</Button></div>)}</div></section> : null}
    </SettingsPage>;
}

function ConfigField({ field, value, required, onChange }: { field: AgentPluginConfigField; value: unknown; required?: boolean; onChange: (value: unknown) => void }) {
    const label = <><span>{field.title}</span>{required ? <span className="text-danger"> *</span> : null}</>;
    if (field.type === "boolean") return <Switch isSelected={Boolean(value)} onChange={onChange}><Switch.Content><span className="font-medium">{label}</span>{field.description ? <span className="mt-1 block text-xs leading-5 text-muted">{field.description}</span> : null}</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>;
    if (field.type === "array") return <ArrayField field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    if (field.type === "object") return <ObjectField field={field} value={asObject(value)} onChange={onChange} />;
    if (field.enum) return <Select.Root aria-label={field.title} selectedKey={String(value ?? field.enum[0] ?? "")} onSelectionChange={(key) => key && onChange(String(key))}><Select.Trigger className="w-full"><Select.Value /></Select.Trigger><Select.Popover><ListBox>{field.enum.map((item) => <ListBox.Item key={item} id={item} textValue={item}>{item}</ListBox.Item>)}</ListBox></Select.Popover></Select.Root>;
    if (field.format === "textarea") return <TextField.Root value={String(value ?? "")} onChange={(next) => onChange(next)}><Label>{label}</Label><TextArea className="min-h-28" /></TextField.Root>;
    return <TextField.Root value={String(value ?? "")} onChange={(next) => onChange(field.type === "number" ? Number(next) : next)}><Label>{label}</Label><Input type={field.format === "password" ? "password" : field.type === "number" ? "number" : "text"} />{field.description ? <span className="text-xs text-muted">{field.description}</span> : null}</TextField.Root>;
}

function ArrayField({ field, value, onChange }: { field: AgentPluginConfigField; value: unknown[]; onChange: (value: unknown[]) => void }) {
    const item = field.items;
    if (!item) return null;
    return <section><div className="mb-3"><h2 className="text-sm font-medium">{field.title}</h2>{field.description ? <p className="mt-1 text-xs leading-5 text-muted">{field.description}</p> : null}</div><div className="space-y-3">{value.map((entry, index) => <Card.Root key={index}><Card.Content className="p-4"><div className="mb-3 flex justify-end"><Button type="button" size="sm" variant="danger" onPress={() => onChange(value.filter((_, current) => current !== index))}>移除</Button></div><ConfigField field={item} value={entry} onChange={(next) => onChange(value.map((current, currentIndex) => currentIndex === index ? next : current))} /></Card.Content></Card.Root>)}</div><Button type="button" className="mt-3" size="sm" variant="secondary" onPress={() => onChange([...value, defaultValue(item)])}>添加{item.title}</Button></section>;
}

function ObjectField({ field, value, onChange }: { field: AgentPluginConfigField; value: Config; onChange: (value: Config) => void }) {
    const properties = field.properties ?? {};
    if (!Object.keys(properties).length) return <KeyValueField field={field} value={value} onChange={onChange} />;
    return <fieldset className="rounded-md border border-border p-4"><legend className="px-1 text-sm font-medium">{field.title}</legend>{field.description ? <p className="mb-4 text-xs leading-5 text-muted">{field.description}</p> : null}<div className="space-y-4">{Object.entries(properties).map(([key, nested]) => <ConfigField key={key} field={nested} required={field.required?.includes(key)} value={value[key] ?? defaultValue(nested)} onChange={(next) => onChange({ ...value, [key]: next })} />)}</div></fieldset>;
}

function KeyValueField({ field, value, onChange }: { field: AgentPluginConfigField; value: Config; onChange: (value: Config) => void }) {
    const [text, setText] = useState(() => JSON.stringify(value, null, 2));
    useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
    return <TextField.Root value={text} onChange={setText} onBlur={() => { try { const next = JSON.parse(text); if (next && !Array.isArray(next) && typeof next === "object") onChange(next); } catch { /* Keep the draft visible until valid JSON is entered. */ } }}><Label>{field.title}</Label><TextArea className="min-h-28 font-mono text-xs" />{field.description ? <span className="text-xs text-muted">{field.description}</span> : null}</TextField.Root>;
}

function asObject(value: unknown): Config { return value && !Array.isArray(value) && typeof value === "object" ? value as Config : {}; }
function defaultValue(field: AgentPluginConfigField): unknown {
    if (field.default !== undefined) return structuredClone(field.default);
    if (field.type === "array") return [];
    if (field.type === "object") return Object.fromEntries(Object.entries(field.properties ?? {}).map(([key, nested]) => [key, defaultValue(nested)]));
    if (field.type === "boolean") return false;
    if (field.type === "number") return 0;
    return "";
}
function withDefaults(schema: AgentPluginConfigSchema, value: Config): Config { return Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key, value[key] === undefined ? defaultValue(field) : field.type === "object" ? { ...defaultValue(field) as Config, ...asObject(value[key]) } : value[key]])); }
