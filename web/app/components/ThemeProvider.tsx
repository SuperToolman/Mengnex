"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type AccentColor = "sky" | "blue" | "violet" | "rose" | "emerald" | "orange";
export type BaseColor = "slate" | "gray" | "zinc" | "neutral" | "stone";
export type FontFamily = "geist" | "inter" | "system" | "serif";
export type RadiusSize = "none" | "small" | "medium" | "large";
export type ThemePreset = "mengnex" | "heroui" | "custom";

export type AppearanceSettings = {
    accent: AccentColor;
    base: BaseColor;
    fontFamily: FontFamily;
    radius: RadiusSize;
    radiusForm: RadiusSize;
    preset: ThemePreset;
};

const THEME_STORAGE_KEY = "mengnex.theme";
const APPEARANCE_STORAGE_KEY = "mengnex.appearance";

export const defaultAppearance: AppearanceSettings = {
    accent: "sky",
    base: "slate",
    fontFamily: "geist",
    radius: "medium",
    radiusForm: "large",
    preset: "mengnex",
};

const heroUIDefaultAppearance: AppearanceSettings = {
    accent: "blue",
    base: "zinc",
    fontFamily: "system",
    radius: "medium",
    radiusForm: "large",
    preset: "heroui",
};

const accentTokens: Record<AccentColor, { accent: string; foreground: string }> = {
    sky: { accent: "oklch(68.5% 0.169 237.3)", foreground: "#ffffff" },
    blue: { accent: "oklch(62.3% 0.214 259.8)", foreground: "#ffffff" },
    violet: { accent: "oklch(60.6% 0.25 292.7)", foreground: "#ffffff" },
    rose: { accent: "oklch(64.5% 0.246 16.4)", foreground: "#ffffff" },
    emerald: { accent: "oklch(69.6% 0.17 162.5)", foreground: "#052e16" },
    orange: { accent: "oklch(70.5% 0.213 47.6)", foreground: "#431407" },
};

const baseTokens: Record<BaseColor, { light: string; dark: string }> = {
    slate: { light: "#f8fafc", dark: "#0f172a" },
    gray: { light: "#f9fafb", dark: "#111827" },
    zinc: { light: "#fafafa", dark: "#18181b" },
    neutral: { light: "#fafafa", dark: "#171717" },
    stone: { light: "#fafaf9", dark: "#1c1917" },
};

const fontTokens: Record<FontFamily, string> = {
    geist: "var(--font-geist-sans), Arial, sans-serif",
    inter: "Inter, ui-sans-serif, system-ui, sans-serif",
    system: "ui-sans-serif, system-ui, sans-serif",
    serif: "Georgia, Cambria, 'Times New Roman', serif",
};

const radiusTokens: Record<RadiusSize, string> = {
    none: "0rem",
    small: "0.25rem",
    medium: "0.5rem",
    large: "0.75rem",
};

function isAppearanceSettings(value: unknown): value is AppearanceSettings {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<AppearanceSettings>;
    return typeof item.accent === "string" && item.accent in accentTokens
        && typeof item.base === "string" && item.base in baseTokens
        && typeof item.fontFamily === "string" && item.fontFamily in fontTokens
        && typeof item.radius === "string" && item.radius in radiusTokens
        && typeof item.radiusForm === "string" && item.radiusForm in radiusTokens
        && ["mengnex", "heroui", "custom"].includes(item.preset ?? "");
}

function getStoredTheme(): ThemeMode {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function getStoredAppearance(): AppearanceSettings {
    if (typeof window === "undefined") return defaultAppearance;
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null");
        return isAppearanceSettings(parsed) ? parsed : defaultAppearance;
    } catch {
        return defaultAppearance;
    }
}

function getSystemTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
    return mode === "system" ? getSystemTheme() : mode;
}

function applyTheme(theme: "light" | "dark", appearance: AppearanceSettings) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const accent = accentTokens[appearance.accent];
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.setProperty("--accent", accent.accent);
    root.style.setProperty("--accent-foreground", accent.foreground);
    root.style.setProperty("--focus", accent.accent);
    root.style.setProperty("--link", accent.accent);
    root.style.setProperty("--background", baseTokens[appearance.base][theme]);
    root.style.setProperty("--font-sans", fontTokens[appearance.fontFamily]);
    root.style.setProperty("--radius", radiusTokens[appearance.radius]);
    root.style.setProperty("--field-radius", radiusTokens[appearance.radiusForm]);
}

type ThemeContextValue = {
    mode: ThemeMode;
    effective: "light" | "dark";
    appearance: AppearanceSettings;
    setMode: (mode: ThemeMode) => void;
    setAppearance: (appearance: AppearanceSettings) => void;
    setPreset: (preset: ThemePreset) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    mode: "system",
    effective: "light",
    appearance: defaultAppearance,
    setMode: () => {},
    setAppearance: () => {},
    setPreset: () => {},
});

export function useTheme() {
    return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>("system");
    const [effective, setEffective] = useState<"light" | "dark">("light");
    const [appearance, setAppearanceState] = useState<AppearanceSettings>(defaultAppearance);

    useEffect(() => {
        const storedMode = getStoredTheme();
        const storedAppearance = getStoredAppearance();
        const resolved = resolveTheme(storedMode);
        setModeState(storedMode);
        setEffective(resolved);
        setAppearanceState(storedAppearance);
        applyTheme(resolved, storedAppearance);
    }, []);

    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = () => {
            if (getStoredTheme() === "system") {
                const resolved = getSystemTheme();
                setEffective(resolved);
                applyTheme(resolved, getStoredAppearance());
            }
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const setMode = useCallback((nextMode: ThemeMode) => {
        const resolved = resolveTheme(nextMode);
        setModeState(nextMode);
        setEffective(resolved);
        window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
        applyTheme(resolved, getStoredAppearance());
    }, []);

    const setAppearance = useCallback((nextAppearance: AppearanceSettings) => {
        const customAppearance = { ...nextAppearance, preset: "custom" as const };
        setAppearanceState(customAppearance);
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(customAppearance));
        applyTheme(resolveTheme(getStoredTheme()), customAppearance);
    }, []);

    const setPreset = useCallback((preset: ThemePreset) => {
        if (preset === "custom") return;
        const nextAppearance = preset === "heroui" ? heroUIDefaultAppearance : defaultAppearance;
        setAppearanceState(nextAppearance);
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(nextAppearance));
        applyTheme(resolveTheme(getStoredTheme()), nextAppearance);
    }, []);

    const value = useMemo(
        () => ({ mode, effective, appearance, setMode, setAppearance, setPreset }),
        [mode, effective, appearance, setMode, setAppearance, setPreset],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
