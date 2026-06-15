"use client";

import { usePathname } from "next/navigation";

export default function PhotoTemplate({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = usePathname();

    return (
        <div key={pathname} className="page-transition h-full">
            {children}
        </div>
    );
}
