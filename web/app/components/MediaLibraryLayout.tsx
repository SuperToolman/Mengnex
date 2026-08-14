import { Card, EmptyState } from "@heroui/react";
import type { ReactNode } from "react";

type MediaLibraryLayoutProps = {
    title: string;
    description?: string;
    header?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
};

/** Shared shell for top-level media library views. */
export default function MediaLibraryLayout({ title, description, header, actions, children }: MediaLibraryLayoutProps) {
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-5">
            <Card.Root className="shrink-0 overflow-x-auto">
                <Card.Header className="flex h-14 min-w-max flex-row items-center justify-between gap-6 px-4 py-0">
                    <div className="flex shrink-0 items-baseline gap-3 whitespace-nowrap">
                        <h1 className="text-base font-semibold text-foreground">{title}</h1>
                        {description ? <p className="text-sm text-muted">{description}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                        {header ? <div className="flex shrink-0 items-center">{header}</div> : null}
                        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
                    </div>
                </Card.Header>
            </Card.Root>
            <section className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</section>
        </div>
    );
}

export function MediaLibraryEmptyState({ message }: { message: string }) {
    return (
        <Card.Root className="flex min-h-full items-center justify-center border-dashed p-8">
            <Card.Content>
                <EmptyState className="max-w-md text-center text-sm text-muted">{message}</EmptyState>
            </Card.Content>
        </Card.Root>
    );
}
