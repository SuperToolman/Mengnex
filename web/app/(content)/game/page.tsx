import MediaLibraryLayout, { MediaLibraryEmptyState } from "@/app/components/MediaLibraryLayout";

export default function GamePage() {
    return <MediaLibraryLayout title="游戏" description="管理和浏览游戏媒体库。"><MediaLibraryEmptyState message="暂时没有可显示的游戏。" /></MediaLibraryLayout>;
}
