import { Card } from "@heroui/react";
import SettingsPage from "../../components/SettingsPage";
import LibraryManagementTabs from "../components/LibraryManagementTabs";

export default function LibraryMetadataPage() {
    return (
        <SettingsPage
            group="媒体库"
            title="元数据管理"
            description="管理媒体识别规则、刮削来源、字段映射与手动修正流程。"
        >
            <LibraryManagementTabs />
            <Card.Root>
                <Card.Content className="p-5">
                <p className="text-sm leading-6 text-muted">
                    这里将用于管理媒体识别规则、刮削来源、字段映射与手动修正流程。当前先保留页面入口，后续可以继续接电影、剧集、动漫、游戏等不同媒体类型的元数据策略。
                </p>
                </Card.Content>
            </Card.Root>
        </SettingsPage>
    );
}
