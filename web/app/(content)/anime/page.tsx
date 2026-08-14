import MediaLibraryLayout, { MediaLibraryEmptyState } from "@/app/components/MediaLibraryLayout";

export default function AnimePage() {
    return <MediaLibraryLayout title="动画" description="管理和浏览动画媒体库。"><MediaLibraryEmptyState message="暂时没有可显示的动画。" /></MediaLibraryLayout>;
}
