export default function SystemLogsPage() {
    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--theme-text-muted)]">
                首选项
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
                系统日志
            </h2>
            <div className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-white/8 p-5">
                <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
                    当前先保留系统日志页面入口。后续可以接后端日志读取、任务执行日志、扫描失败原因以及导出诊断信息。
                </p>
            </div>
        </div>
    );
}
