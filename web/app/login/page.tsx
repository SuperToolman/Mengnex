"use client";

import { Database, Lock, Person, ShieldCheck } from "@gravity-ui/icons";
import { Alert, Button, Card, Chip, Form, Input, Label, Separator, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthStatus, getCurrentUser, login, setupApplication } from "@/src/api/client";

export default function LoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void getAuthStatus()
            .then(async (status) => {
                if (cancelled) return;
                setSetupRequired(status.setup_required);
                if (!status.setup_required) {
                    await getCurrentUser();
                    if (!cancelled) router.replace("/");
                }
            })
            .catch((loadError) => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "无法连接服务");
            });
        return () => { cancelled = true; };
    }, [router]);

    async function submitLogin() {
        try {
            setBusy(true);
            setError(null);
            setSuccess(false);
            if (setupRequired) {
                await setupApplication({ display_name: displayName, username, password });
            } else {
                await login({ username, password });
            }
            setSuccess(true);
            router.replace("/");
        } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : setupRequired ? "初始化失败" : "登录失败");
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background p-4 sm:p-6">
            <Card.Root className="w-full max-w-4xl overflow-hidden">
                <div className="grid min-h-[520px] lg:grid-cols-[1fr_0.85fr]">
                    <Card.Content className="flex flex-col justify-between bg-surface-secondary p-7 sm:p-9 lg:p-10">
                        <div>
                            <div className="flex items-center gap-3">
                                <div className="grid size-10 place-items-center rounded-field bg-accent text-sm font-semibold text-accent-foreground">M</div>
                                <div className="min-w-0">
                                    <Card.Title className="text-base">Mengnex</Card.Title>
                                    <Card.Description>个人媒体资料库</Card.Description>
                                </div>
                            </div>

                            <div className="mt-14 max-w-sm">
                                <Chip size="sm" variant="soft" color="accent" className="gap-1.5">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {setupRequired ? "首次初始化" : "安全访问"}
                                </Chip>
                                <h1 className="mt-4 text-3xl font-semibold text-foreground">{setupRequired ? "创建首个管理员" : "回到你的媒体空间"}</h1>
                                <p className="mt-4 text-sm leading-6 text-muted">
                                    {setupRequired ? "此账户将成为 Owner。完成后即可创建媒体库。" : "登录后管理媒体库、扫描任务、观看记录与账户权限。"}
                                </p>
                            </div>
                        </div>

                        <div className="mt-10 space-y-4">
                            <Separator />
                            <div className="flex flex-wrap gap-2">
                                <Chip size="sm" variant="soft" className="gap-1.5"><Database className="h-3.5 w-3.5" />本地优先</Chip>
                                <Chip size="sm" variant="soft" className="gap-1.5"><Lock className="h-3.5 w-3.5" />权限隔离</Chip>
                            </div>
                        </div>
                    </Card.Content>

                    <Card.Content className="flex items-center p-7 sm:p-9 lg:p-10">
                        <Form
                            className="w-full space-y-5"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submitLogin();
                            }}
                        >
                            <div className="mb-7">
                                <Card.Description>{setupRequired ? "系统初始化" : "账号登录"}</Card.Description>
                                <Card.Title className="mt-1 text-2xl">{setupRequired ? "设置管理员" : "欢迎回来"}</Card.Title>
                            </div>

                            {setupRequired ? (
                                <TextField.Root value={displayName} onChange={setDisplayName} isRequired isDisabled={busy} fullWidth>
                                    <Label>显示名称</Label>
                                    <div className="relative mt-2">
                                        <Person className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" />
                                        <Input autoComplete="name" placeholder="输入显示名称" className="w-full pl-10" />
                                    </div>
                                </TextField.Root>
                            ) : null}

                            <TextField.Root
                                name="username"
                                value={username}
                                onChange={setUsername}
                                isRequired
                                isDisabled={busy}
                                fullWidth
                            >
                                <Label>用户名</Label>
                                <div className="relative mt-2">
                                    <Person className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" />
                                    <Input autoComplete="username" placeholder="输入用户名" className="w-full pl-10" />
                                </div>
                            </TextField.Root>

                            <TextField.Root
                                name="password"
                                value={password}
                                onChange={setPassword}
                                isRequired
                                isDisabled={busy}
                                fullWidth
                            >
                                <Label>密码</Label>
                                <div className="relative mt-2">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" />
                                    <Input type="password" minLength={10} autoComplete={setupRequired ? "new-password" : "current-password"} placeholder={setupRequired ? "至少 10 位字符" : "输入密码"} className="w-full pl-10" />
                                </div>
                            </TextField.Root>

                            {error ? (
                                <Alert status="danger">
                                    <Alert.Indicator />
                                    <Alert.Content>
                                        <Alert.Title>登录失败</Alert.Title>
                                        <Alert.Description>{error}</Alert.Description>
                                    </Alert.Content>
                                </Alert>
                            ) : null}

                            {success ? (
                                <Alert status="success">
                                    <Alert.Indicator />
                                    <Alert.Content>
                                        <Alert.Description>登录成功，正在进入媒体库...</Alert.Description>
                                    </Alert.Content>
                                </Alert>
                            ) : null}

                            <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={busy || setupRequired === null || !username.trim() || password.length < 10 || (setupRequired && !displayName.trim())}>
                                {busy ? "正在处理..." : setupRequired ? "完成初始化" : "登录 Mengnex"}
                            </Button>
                        </Form>
                    </Card.Content>
                </div>
            </Card.Root>
        </main>
    );
}
