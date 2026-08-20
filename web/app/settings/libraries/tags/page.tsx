"use client";

import { Alert, Avatar, Button, Drawer, EmptyState, Form, Input, Modal, Spinner, TextField, useOverlayState } from "@heroui/react";
import { Plus, Xmark } from "@gravity-ui/icons";
import { useEffect, useMemo, useState } from "react";
import SettingsPage from "../../components/SettingsPage";
import { clearTags, createTag, deleteTag, getTagResources, getTags, updateTag, uploadTagAvatar, type TagResponse, type TagResourceResponse } from "@/src/api/client";
import TagCard from "./TagCard";
import AvatarSetting from "@/app/components/AvatarSetting";
import MangaCard from "@/app/(content)/manga/components/MangaCard";
import GalleryItem, { type GalleryItemData } from "@/app/(content)/photo/components/GalleryItem";
import PhotoViewer from "@/app/(content)/photo/components/PhotoViewer";
import LibraryManagementTabs from "../components/LibraryManagementTabs";

export default function TagLibraryPage() {
    const [tags, setTags] = useState<TagResponse[]>([]);
    const [query, setQuery] = useState("");
    const [newName, setNewName] = useState("");
    const [activeTag, setActiveTag] = useState<TagResponse | null>(null);
    const [resources, setResources] = useState<TagResourceResponse[]>([]);
    const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
    const [tagName, setTagName] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<TagResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const deleteModal = useOverlayState();
    const clearModal = useOverlayState();
    const createModal = useOverlayState();
    const detailDrawer = useOverlayState();

    useEffect(() => {
        void getTags()
            .then(setTags)
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "标签库加载失败"));
    }, []);

    const visibleTags = useMemo(() => {
        const term = query.trim().toLocaleLowerCase("zh-CN");
        return term ? tags.filter((tag) => tag.name.toLocaleLowerCase("zh-CN").includes(term)) : tags;
    }, [query, tags]);
    const mangaResources = resources.filter((resource) => resource.resource_type === "manga_series");
    const photoResources = resources.filter((resource) => resource.resource_type === "photo_asset");
    const photoItems: GalleryItemData[] = photoResources.map((resource) => ({ id: resource.id, src: resource.image_src ?? "", originalSrc: resource.image_src ?? "", alt: resource.title }));

    const create = async () => {
        if (!newName.trim() || busy) return;
        try {
            setBusy(true); setError(undefined);
            const tag = await createTag(newName);
            setTags((current) => [...current, tag].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
            setNewName("");
            createModal.close();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "创建标签失败");
        } finally { setBusy(false); }
    };

    const save = async () => {
        if (!activeTag || !tagName.trim() || busy) return;
        try {
            setBusy(true); setError(undefined);
            const tag = await updateTag(activeTag.id, { name: tagName });
            setTags((current) => current.map((item) => item.id === tag.id ? tag : item).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
            setActiveTag(tag);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "更新标签失败");
        } finally { setBusy(false); }
    };

    const remove = async () => {
        if (!deleteTarget || busy) return;
        try {
            setBusy(true); setError(undefined);
            await deleteTag(deleteTarget.id);
            setTags((current) => current.filter((item) => item.id !== deleteTarget.id));
            deleteModal.close(); detailDrawer.close(); setDeleteTarget(null); setActiveTag(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "删除标签失败");
        } finally { setBusy(false); }
    };

    const clear = async () => {
        try { setBusy(true); await clearTags(); setTags([]); setActiveTag(null); clearModal.close(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "清空标签失败"); }
        finally { setBusy(false); }
    };

    return (
        <SettingsPage
            group="媒体库"
            title="标签库"
            description="所有媒体类型共用同一个标签词库。删除标签会同时移除它与媒体资源的关联。"
            actions={<><TextField.Root aria-label="搜索标签" value={query} onChange={setQuery} className="w-full sm:w-72"><Input aria-label="搜索标签" placeholder="搜索标签" /></TextField.Root><Button variant="danger" onPress={() => clearModal.open()} isDisabled={busy || tags.length === 0}>清空标签</Button><Button onPress={createModal.open} className="gap-2"><Plus className="h-4 w-4" />添加标签</Button></>}
            contentClassName="space-y-5"
        >
            <LibraryManagementTabs />
            {error ? <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}

            {visibleTags.length === 0 ? <EmptyState className="min-h-48">{query ? "没有匹配的标签。" : "还没有标签。"}</EmptyState> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
                    {visibleTags.map((tag) => <TagCard
                        key={tag.id}
                        tag={tag}
                        avatarSrc={tag.avatar_url}
                        backgroundSrc={tag.background_url}
                        onPress={() => { setActiveTag(tag); setTagName(tag.name); setResources([]); void getTagResources(tag.id).then(setResources).catch(() => undefined); detailDrawer.open(); }}
                    />)}
                </div>
            )}

            <Drawer.Root state={detailDrawer}>
                <Drawer.Trigger aria-label="打开标签详情抽屉" className="sr-only"><span /></Drawer.Trigger>
                <Drawer.Backdrop>
                    <Drawer.Content placement="right">
                        <Drawer.Dialog className="w-[min(32rem,100vw)] max-w-none">
                            <Drawer.Header className="flex items-center justify-between">
                                <Drawer.Heading>标签详情</Drawer.Heading>
                                <Drawer.CloseTrigger aria-label="关闭" />
                            </Drawer.Header>
                            <Drawer.Body className="space-y-6">
                                {activeTag ? <>
                                    <section className="relative h-36 overflow-hidden rounded-lg bg-surface">
                                        {activeTag.avatar_url ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${activeTag.avatar_url})` }} /> : null}
                                        <div className="absolute inset-0 bg-black/20" />
                                        <Avatar size="lg" className="absolute bottom-4 left-4 h-16 w-16 rounded-lg [&_img]:rounded-lg"><Avatar.Image src={activeTag.avatar_url ?? undefined} alt={tagName} /><Avatar.Fallback className="rounded-lg">{tagName.slice(0, 2) || "标"}</Avatar.Fallback></Avatar>
                                    </section>
                                    <section className="space-y-4">
                                        <TextField.Root value={tagName} onChange={setTagName}><Input aria-label="标签名称" placeholder="标签名称" maxLength={64} /></TextField.Root>
                                        <AvatarSetting label="设置头像" onSave={async (file) => { const updated = await uploadTagAvatar(activeTag.id, file); setTags((current) => current.map((tag) => tag.id === updated.id ? updated : tag)); setActiveTag(updated); }} />
                                    </section>
                                    <section className="border-y border-border py-4"><p className="text-xs text-muted">相关资源 · {resources.length}</p>{mangaResources.length ? <div className="mt-3 grid grid-cols-3 gap-3">{mangaResources.map((resource) => <MangaCard key={resource.id} manga={{ id: resource.id, library_id: "", title: resource.title, layout: "single", cover_src: resource.image_src, author_name: null, tags: [], chapter_count: 1, page_count: 0 }} />)}</div> : null}{photoItems.length ? <div className="mt-4 grid grid-cols-3 gap-2">{photoItems.map((photo, index) => <GalleryItem key={photo.id} item={photo} onOpen={() => setActivePhotoIndex(index)} />)}</div> : null}{resources.filter((resource) => resource.resource_type === "media_item").map((resource) => <p key={resource.id} className="mt-2 truncate text-sm text-foreground">{resource.title}</p>)}{resources.length === 0 ? <p className="mt-3 text-sm text-muted">暂无关联资源。</p> : null}</section>
                                </> : null}
                            </Drawer.Body>
                            <Drawer.Footer className="flex justify-between gap-3"><Button variant="danger" onPress={() => { if (activeTag) { setDeleteTarget(activeTag); deleteModal.open(); } }} isDisabled={!activeTag || busy}>删除标签</Button><Button onPress={() => void save()} isDisabled={!activeTag || !tagName.trim() || busy}>{busy ? <Spinner size="sm" /> : "保存"}</Button></Drawer.Footer>
                        </Drawer.Dialog>
                    </Drawer.Content>
                </Drawer.Backdrop>
            </Drawer.Root>
            <PhotoViewer items={photoItems} activeIndex={activePhotoIndex} onChange={setActivePhotoIndex} onClose={() => setActivePhotoIndex(null)} />

            <Modal state={createModal}>
                <Modal.Trigger aria-label="打开添加标签对话框" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop isDismissable={!busy} variant="blur">
                    <Modal.Container placement="center" className="w-[min(420px,calc(100vw-32px))]">
                        <Modal.Dialog>
                            <Form onSubmit={(event) => { event.preventDefault(); void create(); }}>
                                <Modal.Header>
                                    <Modal.Heading>添加标签</Modal.Heading>
                                </Modal.Header>
                                <Modal.Body>
                                    <TextField.Root aria-label="新标签名称" value={newName} onChange={setNewName}>
                                        <Input autoFocus aria-label="标签名称" placeholder="输入标签名称" maxLength={64} />
                                    </TextField.Root>
                                </Modal.Body>
                                <Modal.Footer className="justify-end gap-3">
                                    <Button variant="secondary" onPress={() => { setNewName(""); createModal.close(); }} isDisabled={busy}>取消</Button>
                                    <Button type="submit" isDisabled={busy || !newName.trim()}>{busy ? <Spinner size="sm" /> : "添加"}</Button>
                                </Modal.Footer>
                            </Form>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal state={deleteModal}>
                <Modal.Trigger aria-label="打开删除标签确认对话框" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop isDismissable={!busy} variant="blur">
                    <Modal.Container placement="center" className="w-[min(480px,calc(100vw-32px))]">
                        <Modal.Dialog className="outline-none">
                            <Modal.Header><div><Modal.Heading>删除标签</Modal.Heading><p className="mt-1 text-sm text-muted">删除后无法恢复。</p></div><Modal.CloseTrigger aria-label="关闭"><Xmark className="h-5 w-5" /></Modal.CloseTrigger></Modal.Header>
                            <Modal.Body className="px-6 py-5 text-sm leading-6 text-muted">{deleteTarget ? <>即将删除“<span className="font-medium text-foreground">{deleteTarget.name}</span>”，并移除它在 {deleteTarget.resource_count} 个媒体资源上的关联。</> : null}</Modal.Body>
                            <Modal.Footer className="justify-end gap-3"><Button variant="secondary" onPress={() => deleteModal.close()} isDisabled={busy}>取消</Button><Button variant="danger" onPress={() => void remove()} isDisabled={busy || !deleteTarget}>{busy ? <Spinner size="sm" /> : "删除标签"}</Button></Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
            <Modal state={clearModal}><Modal.Trigger aria-label="打开清空标签确认对话框" className="sr-only"><span /></Modal.Trigger><Modal.Backdrop isDismissable={!busy} variant="blur"><Modal.Container placement="center" className="w-[min(480px,calc(100vw-32px))]"><Modal.Dialog><Modal.Header><Modal.Heading>清空标签库</Modal.Heading></Modal.Header><Modal.Body>将删除全部标签及其所有资源关联，此操作无法恢复。</Modal.Body><Modal.Footer className="justify-end gap-3"><Button variant="secondary" onPress={() => clearModal.close()} isDisabled={busy}>取消</Button><Button variant="danger" onPress={() => void clear()} isDisabled={busy}>{busy ? <Spinner size="sm" /> : "确认清空"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
        </SettingsPage>
    );
}
