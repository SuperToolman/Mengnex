import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";

export default function MusicPage() {
    return <ContentPageLayout title="音乐" description="管理和浏览音乐媒体库。"><ContentPageEmptyState message="暂时没有可显示的音乐。" /></ContentPageLayout>;
}
