import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";

export default function GamePage() {
    return <ContentPageLayout title="游戏" description="管理和浏览游戏媒体库。"><ContentPageEmptyState message="暂时没有可显示的游戏。" /></ContentPageLayout>;
}
