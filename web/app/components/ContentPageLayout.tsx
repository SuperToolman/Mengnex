import { EmptyState } from "@heroui/react";
import type { ReactNode } from "react";

type ContentPageLayoutProps = {
    title: string;
    description?: string;
    center?: ReactNode;
    header?: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
};

/** Shared shell for primary navigation pages. */
export default function ContentPageLayout({ title, description, center, header, actions, footer, children }: ContentPageLayoutProps) {
    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <header className="relative flex shrink-0 items-center justify-between gap-6 overflow-x-auto px-4 py-3">
                    <div className="flex min-w-0 shrink-0 flex-col">
                        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
                        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
                    </div>
                    {center ? <div className="absolute left-1/2 top-1/2 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2">{center}</div> : null}
                    <div className="flex shrink-0 items-center gap-4">
                        {header ? <div className="flex shrink-0 items-center">{header}</div> : null}
                        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
                    </div>
            </header>
            <section className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</section>
            {footer ? <footer className="shrink-0 px-4 pb-3">{footer}</footer> : null}
        </div>
    );
}

export function ContentPageEmptyState({ message }: { message: string }) {
    return (
        <div className="flex min-h-full items-center justify-center p-8">
            <EmptyState className="max-w-md text-center text-sm text-muted">{message}</EmptyState>
        </div>
    );
}
