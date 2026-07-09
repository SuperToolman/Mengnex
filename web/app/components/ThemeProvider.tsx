"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "mengnex.theme";

function getStoredTheme(): ThemeMode {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
}

function getSystemTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
    if (mode === "system") return getSystemTheme();
    return mode;
}

function applyThemeClass(theme: "light" | "dark") {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
}

type ThemeContextValue = {
    mode: ThemeMode;
    effective: "light" | "dark";
    setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    mode: "system",
    effective: "light",
    setMode: () => {},
});

export function useTheme() {
    return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>("system");
    const [effective, setEffective] = useState<"light" | "dark">("light");

    useEffect(() => {
        const stored = getStoredTheme();
        const resolved = resolveTheme(stored);
        setModeState(stored);
        setEffective(resolved);
        applyThemeClass(resolved);
    }, []);

    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");

        const handler = () => {
            if (getStoredTheme() === "system") {
                const resolved = getSystemTheme();
                setEffective(resolved);
                applyThemeClass(resolved);
            }
        };

        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const setMode = useCallback((nextMode: ThemeMode) => {
        setModeState(nextMode);
        window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
        const resolved = resolveTheme(nextMode);
        setEffective(resolved);
        applyThemeClass(resolved);
    }, []);

    const value = useMemo(() => ({ mode, effective, setMode }), [mode, effective, setMode]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}
