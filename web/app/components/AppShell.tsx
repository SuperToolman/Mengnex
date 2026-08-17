"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCurrentUser } from "@/src/api/client";
import SideBar from "./SideBar";

const PUBLIC_PATHS = new Set(["/login"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const isPublicPath = PUBLIC_PATHS.has(pathname);
    const isImmersiveReader = pathname.startsWith("/manga/read/") || pathname.startsWith("/novel/read/");
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const hasCheckedSessionRef = useRef(false);

    useEffect(() => {
        if (isPublicPath) {
            // A failed check can redirect here. Reset so a later successful login
            // always validates the new session before rendering protected content.
            hasCheckedSessionRef.current = false;
            return;
        }

        if (hasCheckedSessionRef.current) {
            return;
        }

        hasCheckedSessionRef.current = true;

        let cancelled = false;

        void getCurrentUser()
            .then(() => {
                if (!cancelled) {
                    setIsCheckingSession(false);
                }
            })
            .catch(async () => {
                if (cancelled) {
                    return;
                }

                router.replace("/login");
            });

        return () => {
            cancelled = true;
        };
    }, [isPublicPath, router]);

    if (isPublicPath) {
        return <>{children}</>;
    }

    if (isCheckingSession) {
        return (
            <div
                className="flex min-h-dvh items-center justify-center text-sm"
                style={{ background: "var(--app-canvas)", color: "var(--muted)" }}
            >
                正在验证登录状态...
            </div>
        );
    }

    if (isImmersiveReader) {
        return <main className="h-dvh overflow-hidden bg-background">{children}</main>;
    }

    return (
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden" style={{ background: "var(--background)" }}>
            <div className="m-1 min-h-0 flex-1 rounded-lg overflow-hidden">
                <div className="flex h-full min-h-0 overflow-hidden rounded-lg">
                    <SideBar />
                    <main className="content-body relative min-h-0 min-w-0 flex-1 overflow-auto rounded-lg backdrop-blur-xl">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
}
