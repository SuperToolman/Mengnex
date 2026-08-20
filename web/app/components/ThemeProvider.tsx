"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type AccentColor = string;
export type BaseColor = string;
export type FontFamily = "geist" | "inter" | "system" | "serif";
export type RadiusSize = "none" | "small" | "medium" | "large";
export type ThemePreset = "mengnex" | "heroui" | "custom";
export type SurfaceVariant = "default" | "secondary" | "tertiary" | "transparent";

export type AppearanceSettings = {
    accent: AccentColor;
    base: BaseColor;
    foregroundLight: string;
    foregroundDark: string;
    fontFamily: FontFamily;
    radius: RadiusSize;
    radiusForm: RadiusSize;
    preset: ThemePreset;
    surfaceVariant: SurfaceVariant;
};

const THEME_STORAGE_KEY = "mengnex.theme";
const APPEARANCE_STORAGE_KEY = "mengnex.appearance";

export const defaultAppearance: AppearanceSettings = {
    accent: "#0ea5e9",
    base: "#737373",
    foregroundLight: "#171717",
    foregroundDark: "#f5f5f5",
    fontFamily: "geist",
    radius: "medium",
    radiusForm: "large",
    preset: "mengnex",
    surfaceVariant: "secondary",
};

const heroUIDefaultAppearance: AppearanceSettings = {
    accent: "#2563eb",
    base: "#71717a",
    foregroundLight: "#171717",
    foregroundDark: "#f5f5f5",
    fontFamily: "system",
    radius: "medium",
    radiusForm: "large",
    preset: "heroui",
    surfaceVariant: "secondary",
};

const legacyAccentColors: Record<string, string> = {
    sky: "#0ea5e9", blue: "#2563eb", violet: "#7c3aed", rose: "#e11d48", emerald: "#10b981", orange: "#f97316",
};

const legacyBaseColors: Record<string, string> = {
    slate: "#737373", gray: "#6b7280", zinc: "#71717a", neutral: "#737373", stone: "#78716c",
};

type SurfacePalette = {
    surface: string;
    surfaceSecondary: string;
    surfaceTertiary: string;
    field: string;
};

function normalizeColor(value: string, fallback: string) {
    const source = value.trim();
    const expanded = /^#([\da-f]{3})$/i.exec(source);
    const color = expanded ? `#${expanded[1].split("").map((part) => part + part).join("")}` : source;
    return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function colorChannels(color: string) {
    const normalized = normalizeColor(color, "#000000");
    return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function mixColors(source: string, target: string, amount: number) {
    const sourceChannels = colorChannels(source);
    const targetChannels = colorChannels(target);
    return `#${sourceChannels.map((channel, index) => Math.round(channel + (targetChannels[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function getAccentForeground(color: string) {
    const [red, green, blue] = colorChannels(color);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 160 ? "#0f172a" : "#ffffff";
}

function createSurfacePalette(base: string, theme: "light" | "dark"): SurfacePalette {
    if (theme === "light") {
        return {
            surface: mixColors(base, "#ffffff", 0.84),
            surfaceSecondary: mixColors(base, "#ffffff", 0.90),
            surfaceTertiary: mixColors(base, "#ffffff", 0.95),
            field: mixColors(base, "#ffffff", 0.88),
        };
    }

    return {
        surface: mixColors(base, "#000000", 0.68),
        surfaceSecondary: mixColors(base, "#000000", 0.50),
        surfaceTertiary: mixColors(base, "#000000", 0.32),
        field: mixColors(base, "#000000", 0.75),
    };
}

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

function createThemeVariables(theme: "light" | "dark", appearance: AppearanceSettings): Record<string, string> {
    const base = normalizeColor(legacyBaseColors[appearance.base] ?? appearance.base, defaultAppearance.base);
    const accent = normalizeColor(legacyAccentColors[appearance.accent] ?? appearance.accent, defaultAppearance.accent);
    const palette = createSurfacePalette(base, theme);
    const isDark = theme === "dark";
    const canvas = isDark ? "#1c1c1c" : "#EDEDED";
    const foreground = normalizeColor(
        isDark ? appearance.foregroundDark : appearance.foregroundLight,
        isDark ? defaultAppearance.foregroundDark : defaultAppearance.foregroundLight,
    );
    const surfaceForeground = getAccentForeground(palette.surface);
    const fieldForeground = getAccentForeground(palette.field);
    const muted = isDark ? "#a3a3a3" : "#737373";
    const border = isDark ? "rgba(255, 255, 255, 0.20)" : "rgba(0, 0, 0, 0.20)";
    const defaultColor = isDark ? palette.surfaceTertiary : palette.surfaceSecondary;

    return {
        "--background": canvas,
        "--foreground": foreground,
        "--surface": palette.surface,
        "--surface-foreground": surfaceForeground,
        "--surface-secondary": palette.surfaceSecondary,
        "--surface-secondary-foreground": getAccentForeground(palette.surfaceSecondary),
        "--surface-tertiary": palette.surfaceTertiary,
        "--surface-tertiary-foreground": getAccentForeground(palette.surfaceTertiary),
        "--surface-component": appearance.surfaceVariant === "default" ? palette.surface : appearance.surfaceVariant === "tertiary" ? palette.surfaceTertiary : appearance.surfaceVariant === "transparent" ? "transparent" : palette.surfaceSecondary,
        "--surface-component-border": appearance.surfaceVariant === "transparent" ? border : "transparent",
        "--overlay": palette.surface,
        "--overlay-foreground": surfaceForeground,
        "--muted": muted,
        "--border": border,
        "--separator": border,
        "--backdrop": isDark ? "rgba(0, 0, 0, 0.72)" : "rgba(0, 0, 0, 0.48)",
        "--default": defaultColor,
        "--default-foreground": getAccentForeground(defaultColor),
        "--field-background": palette.field,
        "--field-foreground": fieldForeground,
        "--field-placeholder": muted,
        "--field-border": "transparent",
        "--field-border-width": "0px",
        "--accent": accent,
        "--accent-foreground": getAccentForeground(accent),
        "--success": "oklch(73.29% 0.1935 150.81)",
        "--success-foreground": "#052e16",
        "--warning": "oklch(78.19% 0.1585 72.33)",
        "--warning-foreground": "#431407",
        "--danger": "oklch(65.32% 0.2328 25.74)",
        "--danger-foreground": "#ffffff",
        "--focus": accent,
        "--link": accent,
        "--font-sans": fontTokens[appearance.fontFamily],
        "--radius": radiusTokens[appearance.radius],
        "--field-radius": radiusTokens[appearance.radiusForm],
        "--surface-shadow": isDark ? "0 0 0 0 transparent" : "0 2px 4px 0 rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.08)",
        "--overlay-shadow": isDark ? "0 16px 32px 0 rgba(0, 0, 0, 0.36)" : "0 14px 28px 0 rgba(0, 0, 0, 0.16)",
        "--field-shadow": isDark ? "0 0 0 0 transparent" : "0 1px 2px 0 rgba(0, 0, 0, 0.06)",
        "--app-canvas": canvas,
    };
}

function isAppearanceSettings(value: unknown): value is AppearanceSettings {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<AppearanceSettings>;
    return typeof item.accent === "string" && Boolean(legacyAccentColors[item.accent] ?? /^(?:#[\da-f]{3}|#[\da-f]{6})$/i.test(item.accent))
        && typeof item.base === "string" && Boolean(legacyBaseColors[item.base] ?? /^(?:#[\da-f]{3}|#[\da-f]{6})$/i.test(item.base))
        && typeof item.fontFamily === "string" && item.fontFamily in fontTokens
        && typeof item.radius === "string" && item.radius in radiusTokens
        && typeof item.radiusForm === "string" && item.radiusForm in radiusTokens
        && (item.surfaceVariant === undefined || ["default", "secondary", "tertiary", "transparent"].includes(item.surfaceVariant))
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
        if (!isAppearanceSettings(parsed)) return defaultAppearance;
        const appearance = { ...defaultAppearance, ...parsed };
        return {
            ...appearance,
            base: appearance.preset === "mengnex" && appearance.base === "#64748b"
                ? defaultAppearance.base
                : appearance.base,
            foregroundLight: normalizeColor(appearance.foregroundLight, defaultAppearance.foregroundLight),
            foregroundDark: normalizeColor(appearance.foregroundDark, defaultAppearance.foregroundDark),
            surfaceVariant: appearance.surfaceVariant ?? defaultAppearance.surfaceVariant,
        };
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
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.setProperty("--surface-component-border", appearance.surfaceVariant === "transparent" ? "var(--border)" : "transparent");
    const variables = createThemeVariables(theme, appearance);
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
}

const themeInitScript = `(() => {
  try {
    const modes = ["light", "dark", "system"];
    const appearanceKey = ${JSON.stringify(APPEARANCE_STORAGE_KEY)};
    const mode = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const stored = JSON.parse(localStorage.getItem(appearanceKey) || "null");
    const appearance = stored && typeof stored.accent === "string" && typeof stored.base === "string" && ${JSON.stringify(Object.keys(fontTokens))}.includes(stored.fontFamily) && ${JSON.stringify(Object.keys(radiusTokens))}.includes(stored.radius) && ${JSON.stringify(Object.keys(radiusTokens))}.includes(stored.radiusForm) && ["default", "secondary", "tertiary", "transparent"].includes(stored.surfaceVariant) ? stored : ${JSON.stringify(defaultAppearance)};
    const theme = modes.includes(mode) && mode !== "system" ? mode : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.setProperty("--accent", appearance.accent);
    root.style.setProperty("--focus", appearance.accent);
    root.style.setProperty("--link", appearance.accent);
    root.style.setProperty("--foreground", theme === "dark" ? appearance.foregroundDark || ${JSON.stringify(defaultAppearance.foregroundDark)} : appearance.foregroundLight || ${JSON.stringify(defaultAppearance.foregroundLight)});
    root.style.setProperty("--font-sans", ${JSON.stringify(fontTokens)}[appearance.fontFamily]);
    root.style.setProperty("--radius", ${JSON.stringify(radiusTokens)}[appearance.radius]);
    root.style.setProperty("--field-radius", ${JSON.stringify(radiusTokens)}[appearance.radiusForm]);
  } catch {}
})();`;

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
    const [mode, setModeState] = useState<ThemeMode>(getStoredTheme);
    const [effective, setEffective] = useState<"light" | "dark">(() => resolveTheme(getStoredTheme()));
    const [appearance, setAppearanceState] = useState<AppearanceSettings>(getStoredAppearance);

    useEffect(() => {
        applyTheme(effective, appearance);
    }, [appearance, effective]);

    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = () => {
            if (mode === "system") setEffective(getSystemTheme());
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [mode]);

    const setMode = useCallback((nextMode: ThemeMode) => {
        setModeState(nextMode);
        setEffective(resolveTheme(nextMode));
        window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    }, []);

    const setAppearance = useCallback((nextAppearance: AppearanceSettings) => {
        const customAppearance = { ...nextAppearance, preset: "custom" as const };
        setAppearanceState(customAppearance);
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(customAppearance));
    }, []);

    const setPreset = useCallback((preset: ThemePreset) => {
        if (preset === "custom") return;
        const nextAppearance = preset === "heroui" ? heroUIDefaultAppearance : defaultAppearance;
        setAppearanceState(nextAppearance);
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(nextAppearance));
    }, []);

    const value = useMemo(
        () => ({ mode, effective, appearance, setMode, setAppearance, setPreset }),
        [mode, effective, appearance, setMode, setAppearance, setPreset],
    );

    return (
        <ThemeContext.Provider value={value}>
            <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            {children}
        </ThemeContext.Provider>
    );
}
