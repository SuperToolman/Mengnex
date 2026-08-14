"use client";

import { CloudGear, Plus, Xmark } from "@gravity-ui/icons";
import { Button, Input, Modal, TextField, toast, useOverlayState } from "@heroui/react";
import { useEffect, useState, useTransition } from "react";
import { createWebdavConnection, getWebdavConnections, type WebdavConnectionResponse } from "@/src/api/client";
import SettingsPage from "../../components/SettingsPage";

const inputClass = "w-full rounded-xl border border-border bg-white/10 px-3 py-2.5 text-sm text-foreground outline-none focus:border-focus";

export default function RemoteSourcesPage() {
    const modal = useOverlayState({});
    const [connections, setConnections] = useState<WebdavConnectionResponse[]>([]);
    const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
    const [isSaving, startSaving] = useTransition();
    const load = async () => { try { setConnections(await getWebdavConnections()); } catch (cause) { toast.danger(cause instanceof Error ? cause.message : "无法加载远程数据源"); } };
    useEffect(() => { void load(); }, []);
    function submit() {
        if (!name.trim() || !url.trim()) { toast.warning("请填写连接名称和 WebDAV 地址。"); return; }
        startSaving(async () => { try { await createWebdavConnection({ name: name.trim(), url: url.trim(), username, password }); setName(""); setUrl(""); setUsername(""); setPassword(""); modal.close(); toast.success("WebDAV 连接已添加。"); await load(); } catch (cause) { toast.danger(cause instanceof Error ? cause.message : "WebDAV 连接失败"); } });
    }
    return <SettingsPage group="媒体库" title="远程数据源" description="保存 WebDAV 连接后，可在新建媒体库时选择它并填写要扫描的目录。" actions={<Button onPress={modal.open} className="gap-2 rounded-xl bg-accent px-4 text-accent-foreground"><Plus className="h-4 w-4" />添加 WebDAV 连接</Button>}>
        <div className="grid gap-3 md:grid-cols-2">{connections.map((connection) => <div key={connection.id} className="border border-border bg-white/6 p-4"><div className="flex gap-3"><CloudGear className="mt-0.5 h-5 w-5 shrink-0 text-muted" /><div className="min-w-0"><h3 className="font-medium">{connection.name}</h3><p className="mt-1 break-all text-sm text-muted">{connection.url}</p><p className="mt-2 text-xs text-muted">{connection.username || "匿名访问"}</p></div></div></div>)}</div>
        {connections.length === 0 ? <div className="mt-6 border border-dashed border-border py-16 text-center text-sm text-muted">尚未配置远程数据源。</div> : null}
        <Modal state={modal}><Modal.Trigger aria-label="打开添加 WebDAV 连接对话框" className="sr-only"><span /></Modal.Trigger><Modal.Backdrop isDismissable variant="blur" className="fixed inset-0 z-50 flex items-center justify-center p-4"><Modal.Container placement="center" className="w-[min(560px,calc(100vw-32px))]"><Modal.Dialog className="outline-none"><Modal.Header className="flex items-start justify-between border-b border-border px-6 py-5"><div><Modal.Heading className="text-lg font-semibold">添加 WebDAV 连接</Modal.Heading><p className="mt-1 text-sm text-muted">保存前会验证服务器地址与凭据。</p></div><Modal.CloseTrigger aria-label="关闭" className="rounded-lg p-2 hover:bg-white/10"><Xmark className="h-5 w-5" /></Modal.CloseTrigger></Modal.Header><Modal.Body className="space-y-4 px-6 py-5"><label className="block"><span className="mb-2 block text-sm text-muted">连接名称</span><TextField.Root value={name} onChange={setName}><Input placeholder="例如：家庭 NAS" className={inputClass} /></TextField.Root></label><label className="block"><span className="mb-2 block text-sm text-muted">WebDAV 地址</span><TextField.Root value={url} onChange={setUrl}><Input placeholder="https://dav.example.com/remote.php/dav/files/user" className={inputClass} /></TextField.Root></label><label className="block"><span className="mb-2 block text-sm text-muted">用户名</span><TextField.Root value={username} onChange={setUsername}><Input placeholder="可选" className={inputClass} /></TextField.Root></label><label className="block"><span className="mb-2 block text-sm text-muted">密码</span><TextField.Root value={password} onChange={setPassword}><Input type="password" placeholder="可选" className={inputClass} /></TextField.Root></label></Modal.Body><Modal.Footer className="flex justify-end border-t border-border px-6 py-4"><Button onPress={submit} isDisabled={isSaving} className="rounded-xl bg-accent text-accent-foreground">{isSaving ? "正在验证..." : "保存连接"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
    </SettingsPage>;
}
