export default function AccountSecurityPage() {
    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--theme-text-muted)]">
                安全
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
                账号安全
            </h2>
            <div className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-white/8 p-5">
                <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
                    当前先保留账号安全入口。后续可以接密码修改、登录设备管理、会话吊销以及双重验证。
                </p>
            </div>
        </div>
    );
}
