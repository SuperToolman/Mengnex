"use client";

import { Check, ChevronDown, CircleExclamation, Plus } from "@gravity-ui/icons";
import {
    Avatar,
    Button,
    Card,
    Checkbox,
    Form,
    Input,
    ListBox,
    Modal,
    Select,
    TextField,
    Tooltip,
    useOverlayState,
} from "@heroui/react";
import { useEffect, useState } from "react";
import {
    createUser,
    getCurrentUser,
    getRolePermissions,
    getUsers,
    updateRolePermissions,
    type AuthRole,
    type AuthUser,
    type RolePermissions,
} from "@/src/api/client";
import SettingsPage from "../../components/SettingsPage";

const ROLE_DETAILS: Record<AuthRole, { label: string; description: string }> = {
    owner: { label: "Owner", description: "拥有全部系统权限，并且可调整所有角色的权限矩阵。" },
    admin: { label: "Admin", description: "可管理用户、媒体库、系统设置和任务，但不能调整角色权限。" },
    editor: { label: "Editor", description: "可浏览资源，并处理图片删除和回收站恢复。" },
    viewer: { label: "Viewer", description: "仅可浏览资源，不能修改、删除或执行管理操作。" },
};

const PERMISSIONS = [
    { id: "media.read", label: "浏览媒体", description: "查看媒体、预览图、回收站和任务信息。" },
    { id: "media.write", label: "整理媒体", description: "删除图片、恢复回收站资源。" },
    { id: "system.manage", label: "管理系统", description: "管理用户、媒体库、扫描和应用设置。" },
    { id: "role.manage", label: "配置角色", description: "调整角色权限矩阵，仅应授予 Owner。" },
] as const;

const fieldClass = "w-full rounded-xl border border-border bg-white/10 px-4 py-3 text-sm text-foreground outline-none [&_input]:text-foreground [&_input]:placeholder:text-muted";
const modalSurfaceClass = "w-[min(600px,calc(100vw-32px))] max-w-none p-0";

function RoleHelp({ role }: { role: AuthRole }) {
    const details = ROLE_DETAILS[role];
    return (
        <Tooltip>
            <Tooltip.Trigger>
                <Button isIconOnly size="sm" variant="ghost" aria-label={`${details.label} 角色权限说明`}>
                    <CircleExclamation className="h-4 w-4" />
                </Button>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow className="max-w-72">
                <strong className="block">{details.label}</strong>
                <span className="mt-1 block text-xs leading-5">{details.description}</span>
            </Tooltip.Content>
        </Tooltip>
    );
}

function RoleSelect({ value, roles, onChange }: { value: AuthRole; roles: readonly AuthRole[]; onChange: (role: AuthRole) => void }) {
    return (
        <Select.Root selectedKey={value} onSelectionChange={(key) => key && onChange(String(key) as AuthRole)}>
            <Select.Trigger aria-label="用户角色" className={fieldClass}>
                <Select.Value className="min-w-0 flex-1 truncate text-left" />
                <Select.Indicator><ChevronDown className="h-4 w-4" /></Select.Indicator>
            </Select.Trigger>
            <Select.Popover>
                <ListBox>
                    {roles.map((role) => (
                        <ListBox.Item key={role} id={role} textValue={ROLE_DETAILS[role].label} className="rounded-lg px-3 py-2 outline-none data-[focused]:bg-white/10">
                            <div className="flex items-center justify-between gap-4"><span>{ROLE_DETAILS[role].label}</span><span className="text-xs text-muted">{ROLE_DETAILS[role].description}</span></div>
                        </ListBox.Item>
                    ))}
                </ListBox>
            </Select.Popover>
        </Select.Root>
    );
}

export default function AccountSecurityPage() {
    const [current, setCurrent] = useState<AuthUser | null>(null);
    const [users, setUsers] = useState<AuthUser[]>([]);
    const [roles, setRoles] = useState<RolePermissions[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isSavingRole, setIsSavingRole] = useState<AuthRole | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [displayName, setDisplayName] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [avatarUrl, setAvatarUrl] = useState("");
    const [newRole, setNewRole] = useState<AuthRole>("viewer");
    const createModal = useOverlayState({ isOpen: isCreateOpen, onOpenChange: setIsCreateOpen });

    useEffect(() => {
        let cancelled = false;
        void getCurrentUser().then(async ({ user }) => {
            if (cancelled) return;
            setCurrent(user);
            if (user.role === "owner" || user.role === "admin") {
                const [userList, roleList] = await Promise.all([getUsers(), getRolePermissions()]);
                if (!cancelled) { setUsers(userList); setRoles(roleList); }
            } else {
                setUsers([user]);
            }
        }).catch((loadError) => {
            if (!cancelled) setError(loadError instanceof Error ? loadError.message : "无法加载账号信息");
        });
        return () => { cancelled = true; };
    }, []);

    const canManageUsers = current?.role === "owner" || current?.role === "admin";
    const canManageRoles = current?.role === "owner";
    const allowedRoles: readonly AuthRole[] = current?.role === "owner" ? ["viewer", "editor", "admin", "owner"] : ["viewer", "editor", "admin"];

    const resetCreateForm = () => { setDisplayName(""); setUsername(""); setPassword(""); setAvatarUrl(""); setNewRole("viewer"); };
    const togglePermission = (role: AuthRole, permission: string, selected: boolean) => setRoles((items) => items.map((item) => item.role !== role ? item : { ...item, permissions: selected ? [...new Set([...item.permissions, permission])] : item.permissions.filter((value) => value !== permission) }));
    const saveRole = async (item: RolePermissions) => {
        try { setIsSavingRole(item.role); setError(null); const saved = await updateRolePermissions(item.role, item.permissions); setRoles((items) => items.map((value) => value.role === saved.role ? saved : value)); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存角色权限失败"); }
        finally { setIsSavingRole(null); }
    };

    const submitUser = async () => {
        try {
            setIsCreating(true); setError(null);
            const user = await createUser({ display_name: displayName, username, password, avatar_url: avatarUrl || undefined, role: newRole });
            setUsers((items) => [...items, user]); resetCreateForm(); setIsCreateOpen(false);
        } catch (createError) { setError(createError instanceof Error ? createError.message : "创建用户失败"); }
        finally { setIsCreating(false); }
    };

    return (
        <SettingsPage
            className="mx-auto max-w-6xl"
            contentClassName="space-y-6"
            group="安全"
            title="账号安全"
            description="管理用户身份、登录账户与角色权限。"
            actions={canManageUsers ? <Button onPress={() => setIsCreateOpen(true)}><Plus className="h-4 w-4" />创建用户</Button> : null}
        >

            {error ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{error}</div> : null}

            <section><div className="mb-3 flex items-end justify-between"><div><h3 className="font-semibold text-foreground">用户</h3><p className="mt-1 text-sm text-muted">{users.length} 个有效账户</p></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{users.map((user) => (
                <Card.Root key={user.id}>
                    <Card.Header className="flex-row items-center gap-3">
                        <Avatar size="md"><Avatar.Image src={user.avatar_url ?? undefined} /><Avatar.Fallback>{user.display_name.slice(0, 1).toUpperCase()}</Avatar.Fallback></Avatar>
                        <div className="min-w-0 flex-1"><Card.Title className="truncate text-base">{user.display_name}</Card.Title><Card.Description className="truncate">@{user.username}</Card.Description></div>
                        {user.id === current?.id ? <span className="text-xs text-muted">当前</span> : null}
                    </Card.Header>
                    <Card.Footer className="justify-between"><span className="text-sm text-muted">{ROLE_DETAILS[user.role].label}</span><RoleHelp role={user.role} /></Card.Footer>
                </Card.Root>
            ))}</div></section>

            {roles.length > 0 ? <section><div className="mb-3"><h3 className="font-semibold text-foreground">角色权限</h3><p className="mt-1 text-sm text-muted">后端按此权限矩阵实时鉴权。{canManageRoles ? "修改后保存即生效。" : "只有 Owner 可以修改。"}</p></div><div className="grid gap-4 lg:grid-cols-2">{roles.map((item) => (
                <Card.Root key={item.role}>
                    <Card.Header className="flex-row items-center justify-between"><div><Card.Title>{ROLE_DETAILS[item.role].label}</Card.Title><Card.Description>{ROLE_DETAILS[item.role].description}</Card.Description></div><RoleHelp role={item.role} /></Card.Header>
                    <Card.Content className="space-y-2">{PERMISSIONS.map((permission) => (
                        <Checkbox.Root key={permission.id} isSelected={item.permissions.includes(permission.id)} isDisabled={!canManageRoles} onChange={(selected) => togglePermission(item.role, permission.id, selected)} className="w-full rounded-xl border border-border p-3">
                            <Checkbox.Control><Checkbox.Indicator><Check className="h-3.5 w-3.5" /></Checkbox.Indicator></Checkbox.Control>
                            <Checkbox.Content><span className="block text-sm font-medium">{permission.label}</span><span className="mt-1 block text-xs text-muted">{permission.description}</span></Checkbox.Content>
                        </Checkbox.Root>
                    ))}</Card.Content>
                    {canManageRoles ? <Card.Footer className="justify-end"><Button isDisabled={isSavingRole === item.role} onPress={() => void saveRole(item)}>{isSavingRole === item.role ? "保存中..." : "保存权限"}</Button></Card.Footer> : null}
                </Card.Root>
            ))}</div></section> : null}

            <Modal state={createModal}>
                <Modal.Backdrop isDismissable variant="blur" className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-border px-6 py-5"><Modal.Heading className="text-lg font-semibold">创建用户</Modal.Heading><p className="mt-1 text-sm text-muted">显示名称用于界面展示，账户用于登录。</p></Modal.Header>
                            <Modal.Body className="px-6 py-5"><Form id="create-user-form" onSubmit={(event) => { event.preventDefault(); void submitUser(); }} className="grid gap-4 sm:grid-cols-2">
                                <label className="text-sm font-medium">用户名<TextField.Root value={displayName} onChange={setDisplayName}><Input required placeholder="显示名称" className={`mt-2 ${fieldClass}`} /></TextField.Root></label>
                                <label className="text-sm font-medium">账户<TextField.Root value={username} onChange={setUsername}><Input required minLength={3} autoComplete="username" placeholder="登录账户" className={`mt-2 ${fieldClass}`} /></TextField.Root></label>
                                <label className="text-sm font-medium">密码<TextField.Root value={password} onChange={setPassword}><Input required minLength={10} type="password" autoComplete="new-password" placeholder="至少 10 位字符" className={`mt-2 ${fieldClass}`} /></TextField.Root></label>
                                <label className="text-sm font-medium">头像<TextField.Root value={avatarUrl} onChange={setAvatarUrl}><Input type="url" placeholder="图片 URL（可选）" className={`mt-2 ${fieldClass}`} /></TextField.Root></label>
                                <label className="text-sm font-medium sm:col-span-2">角色<div className="mt-2"><RoleSelect value={newRole} roles={allowedRoles} onChange={setNewRole} /></div></label>
                            </Form></Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-5"><Button variant="secondary" onPress={() => setIsCreateOpen(false)}>取消</Button><Button type="submit" form="create-user-form" isDisabled={isCreating}>{isCreating ? "创建中..." : "创建用户"}</Button></Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </SettingsPage>
    );
}
