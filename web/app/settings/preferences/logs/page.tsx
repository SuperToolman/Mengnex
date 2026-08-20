import SettingsPage from "../../components/SettingsPage";

export default function SystemLogsPage() {
    return (
        <SettingsPage
            group="首选项"
            title="系统日志"
            description="查看运行日志、任务执行记录与诊断信息。"
        >
            <div className="rounded-3xl border border-border bg-white/8 p-5">
                <p className="text-sm leading-6 text-muted">
                    当前先保留系统日志页面入口。后续可以接后端日志读取、任务执行日志、扫描失败原因以及导出诊断信息。
                </p>
            </div>
        </SettingsPage>
    );
}
