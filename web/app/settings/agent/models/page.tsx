"use client";

import { Database, Pencil, Plus, Power, Star, StarFill, TrashBin, Xmark } from "@gravity-ui/icons";
import { Button, Card, Form, Input, Label, Modal, Switch, TextField, Tooltip, useOverlayState } from "@heroui/react";
import { useEffect, useState } from "react";
import SettingsPage from "../../components/SettingsPage";
import {
    createAgentModelProvider,
    deleteAgentModelProvider,
    getAgentModelProviders,
    setDefaultAgentModelProvider,
    updateAgentModelProvider,
    type AgentModelProvider,
} from "@/src/features/agent/api";

type ProviderDraft = { name: string; baseUrl: string; model: string; apiKey: string; enabled: boolean };

const PRESETS = [
    { label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { label: "OpenAI", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { label: "Ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
];

const emptyDraft = (): ProviderDraft => ({ name: "", baseUrl: "https://api.openai.com/v1", model: "", apiKey: "", enabled: true });

export default function AgentModelsPage() {
    const [providers, setProviders] = useState<AgentModelProvider[]>([]);
    const [draft, setDraft] = useState<ProviderDraft>(emptyDraft());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [workingId, setWorkingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const editor = useOverlayState();

    async function refresh() {
        setLoading(true);
        try { setProviders((await getAgentModelProviders()).providers); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取模型供应商"); }
        finally { setLoading(false); }
    }

    useEffect(() => { void refresh(); }, []);

    function applyPreset(preset: typeof PRESETS[number]) {
        setDraft({ ...emptyDraft(), ...preset });
        setError(null);
    }

    function startCreate() {
        setEditingId(null);
        setDraft(emptyDraft());
        setError(null);
        editor.open();
    }

    function edit(provider: AgentModelProvider) {
        setEditingId(provider.id);
        setDraft({ name: provider.name, baseUrl: provider.baseUrl, model: provider.model, apiKey: "", enabled: provider.enabled });
        setError(null);
        editor.open();
    }

    async function save() {
        setSaving(true); setError(null);
        try {
            if (editingId) await updateAgentModelProvider(editingId, { ...draft, apiKey: draft.apiKey || undefined });
            else await createAgentModelProvider({ ...draft, apiKey: draft.apiKey || undefined });
            setDraft(emptyDraft()); setEditingId(null); editor.close(); await refresh();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "保存模型供应商失败"); }
        finally { setSaving(false); }
    }

    async function toggle(provider: AgentModelProvider) {
        setWorkingId(provider.id); setError(null);
        try { await updateAgentModelProvider(provider.id, { enabled: !provider.enabled }); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "更新模型状态失败"); }
        finally { setWorkingId(null); }
    }

    async function makeDefault(provider: AgentModelProvider) {
        setWorkingId(provider.id); setError(null);
        try { await setDefaultAgentModelProvider(provider.id); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "设置默认模型失败"); }
        finally { setWorkingId(null); }
    }

    async function remove(provider: AgentModelProvider) {
        setWorkingId(provider.id); setError(null);
        try { await deleteAgentModelProvider(provider.id); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "删除模型供应商失败"); }
        finally { setWorkingId(null); }
    }

    return <SettingsPage group="Agent" title="模型供应商" description="配置 Agent 使用的模型连接。密钥只保存在本机 Agent 数据目录，不会显示在页面或发送到前端。" actions={<Button onPress={startCreate}><Plus className="h-4 w-4" />添加供应商</Button>} contentClassName="max-w-5xl">
        {error ? <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">已配置供应商</h2><p className="mt-1 text-sm text-muted">默认供应商会用于新的 Agent 对话。</p></div><span className="text-xs text-muted">{providers.length} 个连接</span></div>
            {loading ? <p className="py-8 text-center text-sm text-muted">正在加载...</p> : providers.length ? <div className="grid gap-3 md:grid-cols-2">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} working={workingId === provider.id} onEdit={() => edit(provider)} onToggle={() => void toggle(provider)} onDefault={() => void makeDefault(provider)} onDelete={() => void remove(provider)} />)}</div> : <Card.Root variant="secondary" className="border border-[color:var(--surface-component-border)] bg-[var(--surface-component)] shadow-sm"><Card.Content className="flex flex-col items-center gap-2 py-12 text-center"><Database className="h-8 w-8 text-muted" /><p className="font-medium">尚未配置模型供应商</p><p className="text-sm text-muted">点击右上角“添加供应商”开始配置。</p></Card.Content></Card.Root>}
        </section>
        <Modal state={editor}>
            <Modal.Trigger aria-label="打开添加模型供应商对话框" className="sr-only"><span /></Modal.Trigger>
            <Modal.Backdrop isDismissable={!saving} variant="blur">
                <Modal.Container placement="center" className="w-[min(680px,calc(100vw-32px))]">
                    <Modal.Dialog className="max-h-[calc(100dvh-32px)] overflow-hidden outline-none">
                        <Modal.Header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5"><div><Modal.Heading>{editingId ? "编辑模型供应商" : "添加模型供应商"}</Modal.Heading><p className="mt-1 text-sm text-muted">支持 DeepSeek、OpenAI、Ollama 以及其他 OpenAI-compatible 服务。</p></div><Modal.CloseTrigger aria-label="关闭模型供应商对话框" className="rounded-lg p-2 text-muted hover:bg-default"><Xmark className="h-5 w-5" /></Modal.CloseTrigger></Modal.Header>
                        <Modal.Body className="max-h-[calc(100dvh-180px)] overflow-y-auto px-6 py-5">
                            <div className="mb-5 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-muted">快速填充</span>{PRESETS.map((preset) => <Button key={preset.label} size="sm" variant="secondary" onPress={() => applyPreset(preset)}>{preset.label}</Button>)}</div>
                            <Form id="agent-model-provider-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                                <Field label="显示名称" value={draft.name} placeholder="例如：家庭 DeepSeek" onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
                                <Field label="模型名称" value={draft.model} placeholder="例如：deepseek-chat" onChange={(value) => setDraft((current) => ({ ...current, model: value }))} />
                                <div className="sm:col-span-2"><Field label="接口地址" value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={(value) => setDraft((current) => ({ ...current, baseUrl: value }))} /></div>
                                <div className="sm:col-span-2"><Field label={editingId ? "API 密钥（留空表示保持不变）" : "API 密钥"} value={draft.apiKey} type="password" placeholder={editingId ? "已保存的密钥不会回显" : "sk-..."} onChange={(value) => setDraft((current) => ({ ...current, apiKey: value }))} /></div>
                                <div className="sm:col-span-2"><Switch isSelected={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}><Switch.Content><span className="font-medium">保存后启用</span><span className="mt-1 block text-xs text-muted">停用的供应商不会被 Agent 选为默认模型。</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch></div>
                            </Form>
                        </Modal.Body>
                        <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-4"><Button variant="secondary" onPress={() => { setEditingId(null); setDraft(emptyDraft()); editor.close(); }} isDisabled={saving}>取消</Button><Button type="submit" form="agent-model-provider-form" isDisabled={saving}>{saving ? "保存中..." : editingId ? "保存修改" : "添加供应商"}</Button></Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>
    </SettingsPage>;
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
    return <TextField.Root value={value} onChange={onChange}><Label>{label}</Label><Input type={type} placeholder={placeholder} /></TextField.Root>;
}

function ProviderCard({ provider, working, onEdit, onToggle, onDefault, onDelete }: { provider: AgentModelProvider; working: boolean; onEdit: () => void; onToggle: () => void; onDefault: () => void; onDelete: () => void }) {
    return <Card.Root variant="secondary" className="border border-[color:var(--surface-component-border)] bg-[var(--surface-component)] shadow-sm transition-shadow hover:shadow-surface"><Card.Content className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Database className="h-5 w-5" /></div><div className="min-w-0"><h3 className="truncate font-semibold">{provider.name}</h3><p className="mt-1 truncate text-xs text-muted">{provider.model || "未设置模型"} · {provider.baseUrl}</p></div></div><div className="flex shrink-0 gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label="编辑供应商" onPress={onEdit}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑供应商</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={provider.isDefault ? "当前默认供应商" : "设为默认供应商"} isDisabled={working || provider.isDefault || !provider.enabled} onPress={onDefault}>{provider.isDefault ? <StarFill className="h-4 w-4 text-accent" /> : <Star className="h-4 w-4" />}</Button></Tooltip.Trigger><Tooltip.Content>{provider.isDefault ? "当前默认供应商" : "设为默认供应商"}</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={provider.enabled ? "停用供应商" : "启用供应商"} isDisabled={working} onPress={onToggle}><Power className={`h-4 w-4 ${provider.enabled ? "text-success" : "text-muted"}`} /></Button></Tooltip.Trigger><Tooltip.Content>{provider.enabled ? "停用供应商" : "启用供应商"}</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label="删除供应商" isDisabled={working || provider.isDefault} onPress={onDelete}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除供应商</Tooltip.Content></Tooltip></div></div><div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded px-2 py-1 ${provider.enabled ? "bg-success/15 text-success" : "bg-default text-muted"}`}>{provider.enabled ? "已启用" : "已停用"}</span><span className={`rounded px-2 py-1 ${provider.isDefault ? "bg-accent-soft text-accent" : "bg-default text-muted"}`}>{provider.isDefault ? "默认供应商" : provider.hasApiKey ? "已配置密钥" : "无需密钥/未配置"}</span></div></Card.Content></Card.Root>;
}
