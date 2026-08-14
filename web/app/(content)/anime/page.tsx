import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";

export default function AnimePage() {
    return <ContentPageLayout title="动画" description="管理和浏览动画媒体库。"><ContentPageEmptyState message="暂时没有可显示的动画。" /></ContentPageLayout>;
}
