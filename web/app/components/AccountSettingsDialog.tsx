"use client";

import { Avatar, Button, Form, Input, Label, Modal, TextField, toast, type UseOverlayStateReturn } from "@heroui/react";
import { useEffect, useState } from "react";
import { updateCurrentUser, uploadCurrentUserAvatar, type AuthUser } from "@/src/api/client";
import AvatarSetting from "./AvatarSetting";

function formatDate(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type AccountSettingsDialogProps = {
    state: UseOverlayStateReturn;
    user: AuthUser;
    onUserUpdated: (user: AuthUser) => void;
};

export default function AccountSettingsDialog({ state, user, onUserUpdated }: AccountSettingsDialogProps) {
    const [displayName, setDisplayName] = useState(user.display_name);
    const [password, setPassword] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setDisplayName(user.display_name);
        setPassword("");
    }, [user]);

    async function saveProfile() {
        setIsSaving(true);
        try {
            const updated = await updateCurrentUser({ display_name: displayName, password: password || undefined });
            onUserUpdated(updated);
            setPassword("");
            toast.success("账户设置已保存。");
            state.close();
        } catch (error) {
            toast.danger(error instanceof Error ? error.message : "账户设置保存失败");
        } finally {
            setIsSaving(false);
        }
    }

    async function saveAvatar(file: File) {
        const updated = await uploadCurrentUserAvatar(file);
        onUserUpdated(updated);
        toast.success("头像已更新。");
    }

    return (
        <Modal state={state}>
            <Modal.Backdrop isDismissable={!isSaving} variant="blur">
                <Modal.Container placement="center" className="w-[min(640px,calc(100vw-32px))]">
                    <Modal.Dialog className="outline-none">
                        <Modal.Header className="flex items-start justify-between border-b border-border px-6 py-5">
                            <div>
                                <Modal.Heading>账户设置</Modal.Heading>
                                <p className="mt-1 text-sm text-muted">管理你的头像、登录账户和密码。</p>
                            </div>
                            <Modal.CloseTrigger aria-label="关闭账户设置" className="p-2 text-muted hover:bg-default" />
                        </Modal.Header>
                        <Modal.Body className="space-y-6 px-6 py-5">
                            <section className="flex items-center gap-4">
                                <Avatar size="lg" className="h-20 w-20 text-2xl">
                                    {user.avatar_url ? <Avatar.Image src={user.avatar_url} alt={user.display_name} /> : null}
                                    <Avatar.Fallback>{user.display_name.slice(0, 1).toUpperCase()}</Avatar.Fallback>
                                </Avatar>
                                <div>
                                    <p className="font-medium text-foreground">{user.display_name}</p>
                                <p className="mt-1 text-sm text-muted">@{user.username}</p>
                                    <div className="mt-3"><AvatarSetting onSave={saveAvatar} label="设置头像" /></div>
                                </div>
                            </section>

                            <Form id="account-settings-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} className="grid gap-4">
                                <TextField.Root value={displayName} onChange={setDisplayName}>
                                    <Label>显示名称</Label>
                                    <Input required maxLength={64} autoComplete="name" />
                                </TextField.Root>
                                <TextField.Root value={password} onChange={setPassword}>
                                    <Label>新密码</Label>
                                    <Input type="password" minLength={10} autoComplete="new-password" placeholder="留空则不修改" />
                                </TextField.Root>
                            </Form>
                            <dl className="grid gap-4 text-sm">
                                <div>
                                    <dt className="text-muted">账户 ID</dt>
                                    <dd className="mt-1 break-all text-foreground">{user.id}</dd>
                                </div>
                                <div>
                                    <dt className="text-muted">创建时间</dt>
                                    <dd className="mt-1 text-foreground">{formatDate(user.created_at)}</dd>
                                </div>
                            </dl>
                        </Modal.Body>
                        <Modal.Footer className="justify-end gap-3 border-t border-border px-6 py-4">
                            <Button variant="secondary" onPress={state.close} isDisabled={isSaving}>取消</Button>
                            <Button type="submit" form="account-settings-form" isDisabled={isSaving}>{isSaving ? "保存中..." : "保存"}</Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>
    );
}
