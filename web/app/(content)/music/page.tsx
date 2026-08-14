import MediaLibraryLayout, { MediaLibraryEmptyState } from "@/app/components/MediaLibraryLayout";

export default function MusicPage() {
    return <MediaLibraryLayout title="音乐" description="管理和浏览音乐媒体库。"><MediaLibraryEmptyState message="暂时没有可显示的音乐。" /></MediaLibraryLayout>;
}
