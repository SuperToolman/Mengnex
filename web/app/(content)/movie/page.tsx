import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";

export default function MoviePage() {
    return <ContentPageLayout title="电影" description="管理和浏览电影媒体库。"><ContentPageEmptyState message="暂时没有可显示的电影。" /></ContentPageLayout>;
}
