"use client";

import { Display, Moon, Sun } from "@gravity-ui/icons";
import { Switch, Tabs } from "@heroui/react";
import {
    useTheme,
    type AppearanceSettings,
    type FontFamily,
    type RadiusSize,
    type SurfaceVariant,
    type ThemeMode,
    type ThemePreset,
} from "@/app/components/ThemeProvider";
import SettingsPage from "../../components/SettingsPage";
import ColorPickerField from "@/app/components/ColorPickerField";
import InfoTooltip from "@/app/components/InfoTooltip";
import OptionMenu, { type OptionMenuItem } from "@/app/components/OptionMenu";

const modeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
    { id: "light", label: "亮色", icon: Sun },
    { id: "dark", label: "暗色", icon: Moon },
    { id: "system", label: "跟随系统", icon: Display },
];

const accentSwatches = ["#0ea5e9", "#2563eb", "#7c3aed", "#e11d48", "#10b981", "#f97316", "#eab308", "#ec4899"];
const baseSwatches = ["#64748b", "#6b7280", "#71717a", "#737373", "#78716c", "#475569", "#334155", "#52525b"];
const foregroundSwatches = ["#000000", "#171717", "#262626", "#404040", "#737373", "#e5e5e5", "#f5f5f5", "#ffffff"];

const fontOptions: Array<{ id: FontFamily; label: string; fontFamily: string }> = [
    { id: "geist", label: "Geist", fontFamily: "var(--font-geist-sans), Arial, sans-serif" },
    { id: "inter", label: "Inter", fontFamily: "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif" },
    { id: "system", label: "系统字体", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
    { id: "serif", label: "衬线字体", fontFamily: "Georgia, Cambria, 'Times New Roman', serif" },
];

const radiusPreviewTokens: Record<RadiusSize, string> = {
    none: "0rem",
    small: "0.25rem",
    medium: "0.5rem",
    large: "0.75rem",
    xl: "1rem",
    "2xl": "1.5rem",
};

const radiusOptions: Array<OptionMenuItem<RadiusSize> & { symbol: string }> = [
    { id: "none", label: "无", symbol: "N", surfaceStyle: { borderRadius: radiusPreviewTokens.none }, itemClassName: "border" },
    { id: "small", label: "小", symbol: "S", surfaceStyle: { borderRadius: radiusPreviewTokens.small }, itemClassName: "border" },
    { id: "medium", label: "中", symbol: "M", surfaceStyle: { borderRadius: radiusPreviewTokens.medium }, itemClassName: "border" },
    { id: "large", label: "大", symbol: "L", surfaceStyle: { borderRadius: radiusPreviewTokens.large }, itemClassName: "border" },
    { id: "xl", label: "超大", symbol: "XL", surfaceStyle: { borderRadius: radiusPreviewTokens.xl }, itemClassName: "border" },
    { id: "2xl", label: "特大", symbol: "2XL", surfaceStyle: { borderRadius: radiusPreviewTokens["2xl"] }, itemClassName: "border" },
];

const presetOptions: Array<{ id: ThemePreset; label: string }> = [
    { id: "mengnex", label: "Mengnex" },
    { id: "heroui", label: "HeroUI 默认" },
    { id: "custom", label: "自定义" },
];

const surfacePreviewTokens: Record<SurfaceVariant, { backgroundColor: string; color: string; borderColor: string }> = {
    default: { backgroundColor: "var(--surface)", color: "var(--surface-foreground)", borderColor: "transparent" },
    secondary: { backgroundColor: "var(--surface-secondary)", color: "var(--surface-secondary-foreground)", borderColor: "transparent" },
    tertiary: { backgroundColor: "var(--surface-tertiary)", color: "var(--surface-tertiary-foreground)", borderColor: "transparent" },
    transparent: { backgroundColor: "transparent", color: "var(--foreground)", borderColor: "var(--border)" },
};

const surfaceVariantOptions: Array<OptionMenuItem<SurfaceVariant>> = [
    { id: "default", label: "Default", surfaceVariant: "default", surfaceStyle: surfacePreviewTokens.default },
    { id: "secondary", label: "Secondary", surfaceVariant: "secondary", surfaceStyle: surfacePreviewTokens.secondary },
    { id: "tertiary", label: "Tertiary", surfaceVariant: "tertiary", surfaceStyle: surfacePreviewTokens.tertiary },
    { id: "transparent", label: "Transparent", surfaceVariant: "transparent", surfaceStyle: surfacePreviewTokens.transparent, itemClassName: "border" },
];

export default function PreferencesPage() {
    const { mode, appearance, setMode, setAppearance, setPreset } = useTheme();

    function updateAppearance<Key extends keyof AppearanceSettings>(key: Key, value: AppearanceSettings[Key]) {
        setAppearance({ ...appearance, [key]: value });
    }

    return (
        <SettingsPage
            group="首选项"
            title="主题设置"
            description="调整界面模式与 HeroUI 组件的全局视觉样式。"
            actions={
                <Tabs.Root
                    aria-label="界面模式"
                    selectedKey={mode}
                    onSelectionChange={(key) => setMode(key as ThemeMode)}
                    className="w-96"
                >
                    <Tabs.ListContainer className="w-full">
                        <Tabs.List className="grid w-full grid-cols-3">
                            {modeOptions.map((option) => {
                                const Icon = option.icon;

                                return (
                                    <Tabs.Tab key={option.id} id={option.id} className="justify-center whitespace-nowrap">
                                        <Icon className="h-4 w-4" />
                                        {option.label}
                                        <Tabs.Indicator />
                                    </Tabs.Tab>
                                );
                            })}
                        </Tabs.List>
                    </Tabs.ListContainer>
                </Tabs.Root>
            }
        >
            <div>
                <div className="mb-4 flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">主题颜色</h3>
                    <InfoTooltip size={15} content="这些选项直接配置 HeroUI 的语义颜色 token。" />
                </div>

                <div className="space-y-5">
                    <div className="flex">
                        <div className="min-w-64 basis-64"><ColorPickerField label="强调色" value={appearance.accent} swatches={accentSwatches} onChange={(value) => updateAppearance("accent", value)} /></div>
                        <div className="min-w-64 basis-64"><ColorPickerField label="基础色" value={appearance.base} swatches={baseSwatches} onChange={(value) => updateAppearance("base", value)} /></div>
                        <div className="min-w-64 basis-64"><ColorPickerField label="亮色字体颜色" value={appearance.foregroundLight} swatches={foregroundSwatches} onChange={(value) => updateAppearance("foregroundLight", value)} /></div>
                        <div className="min-w-64 basis-64"><ColorPickerField label="暗色字体颜色" value={appearance.foregroundDark} swatches={foregroundSwatches} onChange={(value) => updateAppearance("foregroundDark", value)} /></div>
                    </div>


                </div>
            </div>

            <div className="mt-15">
                <div className="mb-4 flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">组件外观</h3>
                    <InfoTooltip size={15} content="这些选项直接配置 HeroUI 文字、字体和圆角 token。" />
                </div>

                <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
                    <OptionMenu
                        label="Surface"
                        description="选择设置卡片使用的 HeroUI Surface 变体。"
                        value={appearance.surfaceVariant}
                        options={surfaceVariantOptions}
                        onChange={(value) => updateAppearance("surfaceVariant", value)}
                        className="w-full max-w-64"
                    />
                    <OptionMenu label="字体" value={appearance.fontFamily} options={fontOptions} onChange={(value) => updateAppearance("fontFamily", value)} surfaceVariant={appearance.surfaceVariant} prefix={<span className="text-xs">Aa</span>} renderOption={(option) => <><span className="block text-xl font-semibold">Ag</span><span className="mt-1 block text-xs text-muted">{option.label}</span></>} />
                    <OptionMenu label="组件圆角" description="影响菜单、弹窗等界面组件。" value={appearance.radius} options={radiusOptions} onChange={(value) => updateAppearance("radius", value)} surfaceVariant={appearance.surfaceVariant} prefix={<span className="font-semibold">{radiusOptions.find((item) => item.id === appearance.radius)?.symbol}</span>} renderOption={(option) => <><span className="text-xl font-semibold leading-6">{radiusOptions.find((item) => item.id === option.id)?.symbol}</span><span className="text-xs text-muted">{option.label}</span></>} />
                    <OptionMenu label="表单圆角" description="影响输入框和选择框等表单元素。" value={appearance.radiusForm} options={radiusOptions} onChange={(value) => updateAppearance("radiusForm", value)} surfaceVariant={appearance.surfaceVariant} prefix={<span className="font-semibold">{radiusOptions.find((item) => item.id === appearance.radiusForm)?.symbol}</span>} renderOption={(option) => <><span className="text-xl font-semibold leading-6">{radiusOptions.find((item) => item.id === option.id)?.symbol}</span><span className="text-xs text-muted">{option.label}</span></>} />
                    <OptionMenu label="主题预设" value={appearance.preset} options={presetOptions} onChange={setPreset} surfaceVariant={appearance.surfaceVariant} />
                </div>
            </div>

            <div className="mt-15">
                <div className="mb-4 flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">其他</h3>
                    <InfoTooltip size={15} content="启用或禁用界面过渡动画。" />
                </div>

                <div className="flex items-start gap-3">
                    <Switch aria-label="启用界面过渡动画" isSelected={appearance.animationsEnabled} onChange={(value) => updateAppearance("animationsEnabled", value)} className="shrink-0">
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch>
                    <div>
                        <p className="text-sm font-medium text-foreground">启用界面过渡动画</p>
                        <p className="mt-1 text-xs text-muted">关闭后可减少低性能设备上的打开卡顿。</p>
                    </div>
                </div>
            </div>
        </SettingsPage>
    );
}
