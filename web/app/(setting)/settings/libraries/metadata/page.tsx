export default function LibraryMetadataPage() {
    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--theme-text-muted)]">
                媒体库
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
                元数据管理
            </h2>
            <div className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-white/8 p-5">
                <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
                    这里将用于管理媒体识别规则、刮削来源、字段映射与手动修正流程。当前先保留页面入口，后续可以继续接电影、剧集、动漫、游戏等不同媒体类型的元数据策略。
                </p>
            </div>
        </div>
    );
}
