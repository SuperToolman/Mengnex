"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Alert, Button, Chip, Modal, Skeleton } from "@heroui/react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import {
    getRecycleBinItems,
    purgeRecycleBinItem,
    restoreRecycleBinItem,
    type RecycleBinItemResponse,
} from "@/src/api/client";

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "操作失败";
}

function deletedAt(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function RecycleBinPage() {
    const [items, setItems] = useState<RecycleBinItemResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [purgeId, setPurgeId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getRecycleBinItems()
            .then((data) => { if (!cancelled) setItems(data); })
            .catch((cause) => { if (!cancelled) setError(errorMessage(cause)); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const remove = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
    const selected = items.find((item) => item.id === purgeId);

    async function restore(id: string) {
        setBusyId(id);
        setError(null);
        try { await restoreRecycleBinItem(id); remove(id); } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(null); }
    }

    async function purge(id: string) {
        setBusyId(id);
        setError(null);
        try { await purgeRecycleBinItem(id); remove(id); setPurgeId(null); } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(null); }
    }

    return (
        <ContentPageLayout title="回收站" description="已删除的资源会保留在这里，恢复后将重新出现在对应资源库中。" actions={<Chip variant="soft">{items.length} 项</Chip>}>
            {error ? <Alert status="danger" className="mb-4"><Alert.Indicator /><Alert.Content><Alert.Title>操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
            {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((id) => <div key={id} className="border border-border p-4"><div className="space-y-3"><Skeleton className="h-24 rounded-lg" /><Skeleton className="h-4 w-3/5 rounded" /><Skeleton className="h-3 w-full rounded" /></div></div>)}</div> : null}
            {!loading && items.length === 0 ? <ContentPageEmptyState message="回收站为空" /> : null}
            {!loading && items.length > 0 ? <div className="grid gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => (
                <div key={item.id} className="border border-border bg-surface p-4"><div className="flex gap-3"><div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-secondary">{item.image_src ? <Image src={item.image_src} alt="" fill sizes="96px" unoptimized className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted">{item.media_type}</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><Chip size="sm" variant="soft" className="mt-1">{item.media_type}</Chip><p className="mt-2 truncate text-xs text-muted" title={item.original_path}>{item.original_path}</p><p className="mt-1 text-xs text-muted">删除于 {deletedAt(item.deleted_at)}</p></div></div><div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="secondary" isDisabled={busyId === item.id} onPress={() => void restore(item.id)}>恢复</Button><Button size="sm" variant="danger" isDisabled={busyId === item.id} onPress={() => setPurgeId(item.id)}>永久删除</Button></div></div>
            ))}</div> : null}
            <Modal isOpen={purgeId !== null} onOpenChange={(open) => { if (!open) setPurgeId(null); }}>
                <Modal.Trigger aria-label="打开永久删除资源确认对话框" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop variant="blur"><Modal.Container placement="center"><Modal.Dialog><Modal.Header><Modal.Heading>永久删除资源</Modal.Heading></Modal.Header><Modal.Body><p className="text-sm text-muted">确定永久删除“{selected?.title}”及其原始文件吗？此操作无法恢复。</p></Modal.Body><Modal.Footer className="justify-end gap-2"><Button variant="secondary" onPress={() => setPurgeId(null)}>取消</Button><Button variant="danger" isDisabled={busyId !== null} onPress={() => purgeId && void purge(purgeId)}>永久删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
            </Modal>
        </ContentPageLayout>
    );
}
