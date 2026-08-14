"use client";

import { Check, ChevronDown, CircleExclamation, Plus } from "@gravity-ui/icons";
import {
    Alert,
    Avatar,
    Button,
    Card,
    Checkbox,
    Chip,
    Form,
    Input,
    Label,
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
    getMediaLibraries,
    getUsers,
    type AuthRole,
    type AuthUser,
    type LibraryResponse,
} from "@/src/api/client";
import SettingsPage from "../../components/SettingsPage";

const ROLE_DETAILS: Record<AuthRole, { label: string; description: string }> = {
    owner: { label: "Owner", description: "拥有全部系统权限。" },
    admin: { label: "Admin", description: "可管理用户、媒体库、系统设置和任务。" },
    editor: { label: "Editor", description: "可浏览资源，并处理图片删除和回收站恢复。" },
    viewer: { label: "Viewer", description: "仅可浏览资源，不能修改、删除或执行管理操作。" },
};

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
        <Select.Root aria-label="用户角色" selectedKey={value} onSelectionChange={(key) => key && onChange(String(key) as AuthRole)}>
            <Select.Trigger aria-label="用户角色" className="h-10">
                <Select.Value />
                <Select.Indicator><ChevronDown className="h-4 w-4" /></Select.Indicator>
            </Select.Trigger>
            <Select.Popover>
                <ListBox>
                    {roles.map((role) => (
                        <ListBox.Item key={role} id={role} textValue={ROLE_DETAILS[role].label}>
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
    const [error, setError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [displayName, setDisplayName] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [avatarUrl, setAvatarUrl] = useState("");
    const [newRole, setNewRole] = useState<AuthRole>("viewer");
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [libraryIds, setLibraryIds] = useState<string[]>([]);
    const createModal = useOverlayState();

    useEffect(() => {
        let cancelled = false;
        void getCurrentUser().then(async ({ user }) => {
            if (cancelled) return;
            setCurrent(user);
            if (user.role === "owner" || user.role === "admin") {
                const [userList, libraryList] = await Promise.all([getUsers(), getMediaLibraries()]);
                if (!cancelled) { setUsers(userList); setLibraries(libraryList); }
            } else {
                setUsers([user]);
            }
        }).catch((loadError) => {
            if (!cancelled) setError(loadError instanceof Error ? loadError.message : "无法加载账号信息");
        });
        return () => { cancelled = true; };
    }, []);

    const canManageUsers = current?.role === "owner" || current?.role === "admin";
    const allowedRoles: readonly AuthRole[] = current?.role === "owner" ? ["viewer", "editor", "admin", "owner"] : ["viewer", "editor", "admin"];

    const resetCreateForm = () => { setDisplayName(""); setUsername(""); setPassword(""); setAvatarUrl(""); setNewRole("viewer"); setLibraryIds([]); };

    const submitUser = async () => {
        try {
            setIsCreating(true); setError(null);
            const user = await createUser({ display_name: displayName, username, password, avatar_url: avatarUrl || undefined, role: newRole, library_ids: libraryIds });
            setUsers((items) => [...items, user]); resetCreateForm(); createModal.close();
        } catch (createError) { setError(createError instanceof Error ? createError.message : "创建用户失败"); }
        finally { setIsCreating(false); }
    };

    return (
        <SettingsPage
            contentClassName="space-y-6"
            group="安全"
            title="账号安全"
            description="管理用户身份、登录账户与系统内置角色。"
            actions={canManageUsers ? <Button onPress={createModal.open} className="gap-2"><Plus className="h-4 w-4" />创建用户</Button> : null}
        >

            {error ? <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}

            <section><div className="mb-3 flex items-end justify-between"><div><h3 className="font-semibold text-foreground">用户</h3><p className="mt-1 text-sm text-muted">{users.length} 个有效账户</p></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{users.map((user) => (
                <Card.Root key={user.id}>
                    <Card.Header className="flex-row items-center gap-3">
                        <Avatar size="md"><Avatar.Image src={user.avatar_url ?? undefined} /><Avatar.Fallback>{user.display_name.slice(0, 1).toUpperCase()}</Avatar.Fallback></Avatar>
                        <div className="min-w-0 flex-1"><Card.Title className="truncate text-base">{user.display_name}</Card.Title><Card.Description className="truncate">@{user.username}</Card.Description></div>
                        {user.id === current?.id ? <Chip size="sm" variant="soft">当前</Chip> : null}
                    </Card.Header>
                    <Card.Footer className="justify-between"><Chip size="sm" variant="soft">{ROLE_DETAILS[user.role].label}</Chip><RoleHelp role={user.role} /></Card.Footer>
                </Card.Root>
            ))}</div></section>

            <Alert status="default">
                <Alert.Content>
                    <Alert.Title>角色与权限由系统内置</Alert.Title>
                    <Alert.Description>角色决定可执行的操作，权限不能在此页面单独编辑。创建用户时仅可从系统提供的固定角色中选择。</Alert.Description>
                </Alert.Content>
            </Alert>

            <Modal state={createModal}>
                <Modal.Trigger aria-label="打开创建用户对话框" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop isDismissable={!isCreating} variant="blur">
                    <Modal.Container placement="center" className="w-[min(600px,calc(100vw-32px))]">
                        <Modal.Dialog>
                            <Modal.Header><div><Modal.Heading>创建用户</Modal.Heading><p className="mt-1 text-sm text-muted">显示名称用于界面展示，账户用于登录。</p></div></Modal.Header>
                            <Modal.Body><Form id="create-user-form" onSubmit={(event) => { event.preventDefault(); void submitUser(); }} className="grid gap-4 sm:grid-cols-2">
                                <TextField.Root value={displayName} onChange={setDisplayName}><Label>显示名称</Label><Input required placeholder="显示名称" /></TextField.Root>
                                <TextField.Root value={username} onChange={setUsername}><Label>账户</Label><Input required minLength={3} autoComplete="username" placeholder="登录账户" /></TextField.Root>
                                <TextField.Root value={password} onChange={setPassword}><Label>密码</Label><Input required minLength={10} type="password" autoComplete="new-password" placeholder="至少 10 位字符" /></TextField.Root>
                                <TextField.Root value={avatarUrl} onChange={setAvatarUrl}><Label>头像地址</Label><Input type="url" placeholder="图片 URL（可选）" /></TextField.Root>
                                <div className="sm:col-span-2"><Label>角色</Label><div className="mt-2"><RoleSelect value={newRole} roles={allowedRoles} onChange={setNewRole} /></div></div>
                                {newRole === "viewer" || newRole === "editor" ? <fieldset className="space-y-2 sm:col-span-2"><legend className="mb-2 text-sm font-medium">可访问媒体库</legend>{libraries.map((library) => <Checkbox.Root key={library.id} isSelected={libraryIds.includes(library.id)} onChange={(selected) => setLibraryIds((currentIds) => selected ? [...new Set([...currentIds, library.id])] : currentIds.filter((id) => id !== library.id))} className="w-full"><Checkbox.Control><Checkbox.Indicator><Check className="h-3.5 w-3.5" /></Checkbox.Indicator></Checkbox.Control><Checkbox.Content><span className="text-sm">{library.name}</span></Checkbox.Content></Checkbox.Root>)}</fieldset> : null}
                            </Form></Modal.Body>
                            <Modal.Footer className="justify-end gap-3"><Button variant="secondary" onPress={() => { resetCreateForm(); createModal.close(); }} isDisabled={isCreating}>取消</Button><Button type="submit" form="create-user-form" isDisabled={isCreating}>{isCreating ? "创建中..." : "创建用户"}</Button></Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </SettingsPage>
    );
}
