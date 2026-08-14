import SettingsPage from "../../components/SettingsPage";

export default function LibraryMetadataPage() {
    return (
        <SettingsPage
            group="媒体库"
            title="元数据管理"
            description="管理媒体识别规则、刮削来源、字段映射与手动修正流程。"
        >
            <div className="rounded-3xl border border-border bg-white/8 p-5">
                <p className="text-sm leading-6 text-muted">
                    这里将用于管理媒体识别规则、刮削来源、字段映射与手动修正流程。当前先保留页面入口，后续可以继续接电影、剧集、动漫、游戏等不同媒体类型的元数据策略。
                </p>
            </div>
        </SettingsPage>
    );
}
