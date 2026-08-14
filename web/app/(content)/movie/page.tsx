import MediaLibraryLayout, { MediaLibraryEmptyState } from "@/app/components/MediaLibraryLayout";

export default function MoviePage() {
    return <MediaLibraryLayout title="电影" description="管理和浏览电影媒体库。"><MediaLibraryEmptyState message="暂时没有可显示的电影。" /></MediaLibraryLayout>;
}
