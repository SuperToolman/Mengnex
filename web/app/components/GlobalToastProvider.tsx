"use client";

import { ToastProvider } from "@heroui/react";

export default function GlobalToastProvider() {
    return <ToastProvider placement="bottom end" maxVisibleToasts={4} />;
}
