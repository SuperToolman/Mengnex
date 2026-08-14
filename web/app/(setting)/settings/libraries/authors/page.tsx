"use client";

import { Avatar, Drawer, ListBox, Select, Slider, Spinner, useOverlayState, type UseOverlayStateReturn } from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import { useEffect, useMemo, useState } from "react";
import { deleteAuthorAvatar, getAuthor, getAuthors, selectAuthorAvatar, uploadAuthorAvatar, type AuthorDetailResponse, type AuthorResponse } from "@/src/api/client";
import MangaCard from "@/app/(content)/manga/components/MangaCard";
import GalleryItem, { type GalleryItemData } from "@/app/(content)/photo/components/GalleryItem";
import PhotoViewer from "@/app/(content)/photo/components/PhotoViewer";
import AvatarSetting from "@/app/components/AvatarSetting";
import AuthorCard from "./AuthorCard";
import SettingsPage from "../../components/SettingsPage";
import LibraryManagementTabs from "../components/LibraryManagementTabs";

function photoItem(photo: AuthorDetailResponse["photos"][number]): GalleryItemData {
    return { id: photo.id, src: photo.preview_src ?? photo.src, alt: photo.title, fileName: photo.file_name, width: photo.width ?? undefined, height: photo.height ?? undefined };
}

function AuthorDrawer({ authorId, drawer, onAvatarUploaded }: { authorId: string | null; drawer: UseOverlayStateReturn; onAvatarUploaded: (author: AuthorResponse) => void }) {
    const [detail, setDetail] = useState<AuthorDetailResponse>();
    const [error, setError] = useState<string>();
    const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);

    useEffect(() => {
        if (!authorId) return;
        void getAuthor(authorId).then(setDetail).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "作者详情加载失败"));
    }, [authorId, drawer]);

    return (
        <>
        <Drawer.Root state={drawer}>
            <Drawer.Trigger aria-label="打开作者信息抽屉" className="sr-only"><span /></Drawer.Trigger>
            <Drawer.Backdrop>
                <Drawer.Content placement="right" className="w-[min(48rem,100vw)] max-w-none">
                    <Drawer.Dialog>
                        <Drawer.Header className="flex items-center justify-between">
                            <Drawer.Heading>作者信息</Drawer.Heading>
                            <Drawer.CloseTrigger aria-label="关闭" />
                        </Drawer.Header>
                        <Drawer.Body className="space-y-6">
                            {error ? <p className="text-sm text-red-500">{error}</p> : null}
                            {!detail && !error ? <div className="flex justify-center py-12"><Spinner /></div> : null}
                            {detail ? <>
                                <section className="flex flex-col items-center text-center">
                                    <Avatar size="lg" className="h-[170px] w-[170px]">
                                        {detail.avatar_src ? <Avatar.Image src={detail.avatar_src} alt={detail.name} /> : null}
                                        <Avatar.Fallback className="!text-3xl">{detail.name.slice(0, 3)}</Avatar.Fallback>
                                    </Avatar>
                                    <div className="mt-4"><h2 className="font-semibold">{detail.name}</h2><p className="mt-1 text-sm text-muted">{detail.resource_count} 个关联资源</p></div>
                                    <div className="mt-4"><AvatarSetting onSave={async (file) => { const updated = await uploadAuthorAvatar(detail.id, file); onAvatarUploaded(updated); setDetail(await getAuthor(detail.id)); }} history={detail.avatar_history} onUseHistory={async (avatarId) => { const updated = await selectAuthorAvatar(detail.id, avatarId); onAvatarUploaded(updated); setDetail(await getAuthor(detail.id)); }} onDeleteHistory={async (avatarId) => { const updated = await deleteAuthorAvatar(detail.id, avatarId); onAvatarUploaded(updated); setDetail(await getAuthor(detail.id)); }} /></div>
                                </section>
                                {detail.manga.length > 0 ? <section><h3 className="mb-3 text-sm font-semibold">漫画</h3><div className="grid grid-cols-4 gap-3">{detail.manga.map((manga) => <MangaCard key={manga.id} manga={manga} />)}</div></section> : null}
                                {detail.photos.length > 0 ? <section><h3 className="mb-3 text-sm font-semibold">照片</h3><div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{detail.photos.map((photo, index) => <GalleryItem key={photo.id} item={photoItem(photo)} onOpen={() => setActivePhotoIndex(index)} />)}</div></section> : null}
                            </> : null}
                        </Drawer.Body>
                    </Drawer.Dialog>
                </Drawer.Content>
            </Drawer.Backdrop>
        </Drawer.Root>
        {detail ? <PhotoViewer items={detail.photos.map(photoItem)} activeIndex={activePhotoIndex} onChange={setActivePhotoIndex} onClose={() => setActivePhotoIndex(null)} /> : null}
        </>
    );
}

export default function AuthorsPage() {
    const [authors, setAuthors] = useState<AuthorResponse[]>([]);
    const [sortBy, setSortBy] = useState<"name" | "created" | "resources" | "media">("name");
    const [zoomLevel, setZoomLevel] = useState(2);
    const [activeAuthorId, setActiveAuthorId] = useState<string | null>(null);
    const [error, setError] = useState<string>();
    const drawer = useOverlayState();
    const options = [{ id: "name", label: "作者名称" }, { id: "created", label: "创建时间" }, { id: "resources", label: "资源数量" }, { id: "media", label: "媒体类型" }] as const;
    const zoomClasses = ["grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7", "grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-8"] as const;
    const zoomLabels = ["小", "较小", "正常", "较大", "大"] as const;
    useEffect(() => { void getAuthors().then(setAuthors).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "作者库加载失败")); }, []);
    const sortedAuthors = useMemo(() => [...authors].sort((left, right) => {
        if (sortBy === "created") return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (sortBy === "resources") return right.resource_count - left.resource_count || left.name.localeCompare(right.name, "zh-CN");
        if (sortBy === "media") return left.resource_types.join(",").localeCompare(right.resource_types.join(","), "zh-CN") || left.name.localeCompare(right.name, "zh-CN");
        return left.name.localeCompare(right.name, "zh-CN");
    }), [authors, sortBy]);
    return <SettingsPage group="媒体库" title="作者库" description="查看从漫画标题和照片 EXIF 中识别出的作者。" actions={<><div className="flex items-center gap-2"><span className="text-sm text-muted">排序</span><Select.Root aria-label="作者排序方式" selectedKey={sortBy} onSelectionChange={(key) => key && setSortBy(String(key) as typeof sortBy)}><Select.Trigger className="h-9 w-32"><Select.Value /><Select.Indicator><ChevronDown className="h-4 w-4" /></Select.Indicator></Select.Trigger><Select.Popover><ListBox>{options.map((option) => <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}</ListBox.Item>)}</ListBox></Select.Popover></Select.Root></div><div className="flex items-center gap-2"><span className="whitespace-nowrap text-sm text-muted">内容：{zoomLabels[zoomLevel]}</span><Slider aria-label="作者内容缩放" className="w-32" minValue={0} maxValue={4} step={1} value={zoomLevel} onChange={(value) => setZoomLevel(Array.isArray(value) ? value[0] ?? 2 : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider></div></>} contentClassName="space-y-6"><><LibraryManagementTabs />{error ? <p className="text-sm text-danger">{error}</p> : null}<div className={`grid gap-3 ${zoomClasses[zoomLevel] ?? zoomClasses[2]}`}>{sortedAuthors.map((author) => <AuthorCard key={author.id} author={author} onPress={() => { setActiveAuthorId(author.id); drawer.open(); }} />)}</div>{!error && authors.length === 0 ? <p className="text-sm text-muted">尚未识别到作者。</p> : null}<AuthorDrawer authorId={activeAuthorId} drawer={drawer} onAvatarUploaded={(updated) => setAuthors((current) => current.map((author) => author.id === updated.id ? updated : author))} /></></SettingsPage>;
}
