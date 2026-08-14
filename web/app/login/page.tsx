"use client";

import { Database, Lock, Person, ShieldCheck } from "@gravity-ui/icons";
import { Alert, Button, Card, Chip, Form, Input, Label, Separator, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser, login } from "@/src/api/client";

export default function LoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void getCurrentUser().then(() => router.replace("/photo")).catch(() => undefined);
    }, [router]);

    async function submitLogin() {
        try {
            setBusy(true);
            setError(null);
            setSuccess(false);
            await login({ username, password });
            setSuccess(true);
            router.replace("/photo");
        } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : "登录失败");
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
                                    安全访问
                                </Chip>
                                <h1 className="mt-4 text-3xl font-semibold text-foreground">回到你的媒体空间</h1>
                                <p className="mt-4 text-sm leading-6 text-muted">
                                    登录后管理媒体库、扫描任务、观看记录与账户权限。
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
                                <Card.Description>账号登录</Card.Description>
                                <Card.Title className="mt-1 text-2xl">欢迎回来</Card.Title>
                            </div>

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
                                    <Input type="password" autoComplete="current-password" placeholder="输入密码" className="w-full pl-10" />
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

                            <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={busy || !username.trim() || !password}>
                                {busy ? "正在验证..." : "登录 Mengnex"}
                            </Button>
                        </Form>
                    </Card.Content>
                </div>
            </Card.Root>
        </main>
    );
}
