"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Gear, Person } from "@gravity-ui/icons";
import { Avatar, Popover, useOverlayState } from "@heroui/react";
import AccountSettingsDialog from "@/app/components/AccountSettingsDialog";
import { getCurrentUser, logout, type AuthUser } from "@/src/api/client";

function UserLabel({ children, expanded }: { children: React.ReactNode; expanded: boolean }) {
    return (
        <span
            aria-hidden={!expanded}
            className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ${
                expanded ? "max-w-24 translate-x-0 opacity-100" : "max-w-0 -translate-x-1 opacity-0"
            }`}
        >
            {children}
        </span>
    );
}

export default function UserSidebarItem({ expanded }: { expanded: boolean }) {
    const router = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const accountSettings = useOverlayState({});

    useEffect(() => {
        let cancelled = false;

        void getCurrentUser()
            .then(({ user: currentUser }) => {
                if (!cancelled) {
                    setUser(currentUser);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    const displayName = user?.display_name ?? "当前用户";
    const avatarFallback = displayName.slice(0, 1).toUpperCase();

    async function handleLogout() {
        setIsLoggingOut(true);

        try {
            await logout();
        } finally {
            router.replace("/login");
        }
    }

    return (
        <div className={`px-2 pb-1 ${expanded ? "w-full" : "w-fit"}`}>
            <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
                <Popover.Trigger>
                    <button
                        type="button"
                        aria-label="打开用户菜单"
                        title={expanded ? undefined : displayName}
                        className={`flex h-12 items-center overflow-hidden rounded-[20px] px-[14px] text-sm font-medium text-slate-500 transition-[color,width,gap,background-color] duration-300 hover:text-slate-900 focus:outline-none dark:text-slate-400 dark:hover:text-slate-200 ${
                            expanded ? "w-full gap-3" : "w-12 gap-0"
                        }`}
                    >
                        <Avatar size="sm" className="h-5 w-5 shrink-0 text-[10px]">
                            {user?.avatar_url ? <Avatar.Image src={user.avatar_url} alt={displayName} /> : null}
                            <Avatar.Fallback>{avatarFallback}</Avatar.Fallback>
                        </Avatar>
                        <UserLabel expanded={expanded}>{displayName}</UserLabel>
                    </button>
                </Popover.Trigger>
                <Popover.Content placement="top start" className="z-50 w-64 p-1">
                    <Popover.Arrow />
                    <Popover.Dialog aria-label="用户菜单" className="outline-none">
                        <div className="flex items-center gap-3 px-3 py-3">
                            <Avatar size="md" className="h-9 w-9 shrink-0">
                                {user?.avatar_url ? <Avatar.Image src={user.avatar_url} alt={displayName} /> : null}
                                <Avatar.Fallback>{avatarFallback}</Avatar.Fallback>
                            </Avatar>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                                <p className="truncate text-xs text-muted">@{user?.username ?? "-"}</p>
                            </div>
                        </div>
                        <div className="border-t border-border py-1">
                            <button type="button" onClick={() => { setIsOpen(false); accountSettings.open(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none transition hover:bg-default focus:bg-default">
                                <Gear className="h-4 w-4 shrink-0" />
                                账户设置
                            </button>
                            <button type="button" disabled={isLoggingOut} onClick={() => void handleLogout()} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-danger outline-none transition hover:bg-danger/10 focus:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50">
                                <Person className="h-4 w-4 shrink-0" />
                                {isLoggingOut ? "正在退出..." : "退出登录"}
                            </button>
                        </div>
                    </Popover.Dialog>
                </Popover.Content>
            </Popover>
            {user ? <AccountSettingsDialog state={accountSettings} user={user} onUserUpdated={setUser} /> : null}
        </div>
    );
}
