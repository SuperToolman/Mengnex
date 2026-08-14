"use client";

import { ChevronDown, Display, Moon, Sun } from "@gravity-ui/icons";
import { Label, ListBox, Select, Tabs } from "@heroui/react";
import {
    useTheme,
    type AppearanceSettings,
    type FontFamily,
    type RadiusSize,
    type ThemeMode,
    type ThemePreset,
} from "@/app/components/ThemeProvider";
import SettingsPage from "../../components/SettingsPage";
import ColorPickerField from "@/app/components/ColorPickerField";

const modeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
    { id: "light", label: "亮色", icon: Sun },
    { id: "dark", label: "暗色", icon: Moon },
    { id: "system", label: "跟随系统", icon: Display },
];

const accentSwatches = ["#0ea5e9", "#2563eb", "#7c3aed", "#e11d48", "#10b981", "#f97316", "#eab308", "#ec4899"];
const baseSwatches = ["#64748b", "#6b7280", "#71717a", "#737373", "#78716c", "#475569", "#334155", "#52525b"];
const foregroundSwatches = ["#000000", "#171717", "#262626", "#404040", "#737373", "#e5e5e5", "#f5f5f5", "#ffffff"];

const fontOptions: Array<{ id: FontFamily; label: string }> = [
    { id: "geist", label: "Geist" },
    { id: "inter", label: "Inter" },
    { id: "system", label: "系统字体" },
    { id: "serif", label: "衬线字体" },
];

const radiusOptions: Array<{ id: RadiusSize; label: string; symbol: string }> = [
    { id: "none", label: "无", symbol: "N" },
    { id: "small", label: "小", symbol: "S" },
    { id: "medium", label: "中", symbol: "M" },
    { id: "large", label: "大", symbol: "L" },
];

const presetOptions: Array<{ id: ThemePreset; label: string }> = [
    { id: "mengnex", label: "Mengnex" },
    { id: "heroui", label: "HeroUI 默认" },
    { id: "custom", label: "自定义" },
];

function OptionSelect<T extends string>({
    label,
    value,
    options,
    onChange,
    className = "w-44",
    renderPrefix,
}: {
    label: string;
    value: T;
    options: Array<{ id: T; label: string }>;
    onChange: (value: T) => void;
    className?: string;
    renderPrefix?: (value: T) => React.ReactNode;
}) {
    return (
        <div className={className}>
            <Label>{label}</Label>
            <Select.Root aria-label={label} selectedKey={value} onSelectionChange={(key) => key && onChange(String(key) as T)}>
                <Select.Trigger>
                    {renderPrefix?.(value)}
                    <Select.Value />
                    <Select.Indicator><ChevronDown /></Select.Indicator>
                </Select.Trigger>
                <Select.Popover>
                    <ListBox>
                        {options.map((option) => (
                            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                                {option.label}
                            </ListBox.Item>
                        ))}
                    </ListBox>
                </Select.Popover>
            </Select.Root>
        </div>
    );
}

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
            <section>
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">组件外观</h3>
                    <p className="mt-1 text-xs leading-5 text-muted">这些选项直接配置 HeroUI 的语义颜色、文字、字体和圆角 token。</p>
                </div>

                <div className="space-y-5">
                    <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
                        <div className="min-w-64 flex-1 basis-64"><ColorPickerField label="强调色" value={appearance.accent} swatches={accentSwatches} onChange={(value) => updateAppearance("accent", value)} /></div>
                        <div className="min-w-64 flex-1 basis-64"><ColorPickerField label="基础色" value={appearance.base} swatches={baseSwatches} onChange={(value) => updateAppearance("base", value)} /></div>
                        <div className="min-w-64 flex-1 basis-64"><ColorPickerField label="亮色字体颜色" value={appearance.foregroundLight} swatches={foregroundSwatches} onChange={(value) => updateAppearance("foregroundLight", value)} /></div>
                        <div className="min-w-64 flex-1 basis-64"><ColorPickerField label="暗色字体颜色" value={appearance.foregroundDark} swatches={foregroundSwatches} onChange={(value) => updateAppearance("foregroundDark", value)} /></div>
                    </div>

                    <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
                        <OptionSelect label="字体" value={appearance.fontFamily} options={fontOptions} onChange={(value) => updateAppearance("fontFamily", value)} renderPrefix={() => <span className="text-xs text-muted">Aa</span>} />
                        <OptionSelect label="组件圆角" value={appearance.radius} options={radiusOptions} onChange={(value) => updateAppearance("radius", value)} renderPrefix={(value) => <span className="font-semibold">{radiusOptions.find((item) => item.id === value)?.symbol}</span>} />
                        <OptionSelect label="表单圆角" value={appearance.radiusForm} options={radiusOptions} onChange={(value) => updateAppearance("radiusForm", value)} renderPrefix={(value) => <span className="font-semibold">{radiusOptions.find((item) => item.id === value)?.symbol}</span>} />
                        <OptionSelect label="主题预设" value={appearance.preset} options={presetOptions} onChange={setPreset} />
                    </div>
                </div>
            </section>
        </SettingsPage>
    );
}
