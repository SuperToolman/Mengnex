"use client";

import { ChevronDown, Display, Moon, Sun } from "@gravity-ui/icons";
import { Button, ListBox, Select } from "@heroui/react";
import {
    useTheme,
    type AccentColor,
    type AppearanceSettings,
    type BaseColor,
    type FontFamily,
    type RadiusSize,
    type ThemeMode,
    type ThemePreset,
} from "@/app/components/ThemeProvider";
import SettingsPage from "../../components/SettingsPage";

const modeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
    { id: "light", label: "亮色", icon: Sun },
    { id: "dark", label: "暗色", icon: Moon },
    { id: "system", label: "跟随系统", icon: Display },
];

const accentOptions: Array<{ id: AccentColor; label: string; color: string }> = [
    { id: "sky", label: "天蓝", color: "#0ea5e9" },
    { id: "blue", label: "蓝色", color: "#2563eb" },
    { id: "violet", label: "紫罗兰", color: "#7c3aed" },
    { id: "rose", label: "玫红", color: "#e11d48" },
    { id: "emerald", label: "翠绿", color: "#10b981" },
    { id: "orange", label: "橙色", color: "#f97316" },
];

const baseOptions: Array<{ id: BaseColor; label: string; color: string }> = [
    { id: "slate", label: "Slate", color: "#64748b" },
    { id: "gray", label: "Gray", color: "#6b7280" },
    { id: "zinc", label: "Zinc", color: "#71717a" },
    { id: "neutral", label: "Neutral", color: "#737373" },
    { id: "stone", label: "Stone", color: "#78716c" },
];

const fontOptions: Array<{ id: FontFamily; label: string }> = [
    { id: "geist", label: "Geist" },
    { id: "inter", label: "Inter" },
    { id: "system", label: "System UI" },
    { id: "serif", label: "Serif" },
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

const controlLabelClass = "mb-2 block text-xs font-medium text-muted";
const selectTriggerClass = "flex h-10 w-full items-center justify-between rounded-field border border-[var(--border)] bg-field px-3 text-sm text-[var(--field-foreground)] shadow-sm outline-none";

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
        <label className={className}>
            <span className={controlLabelClass}>{label}</span>
            <Select.Root selectedKey={value} onSelectionChange={(key) => key && onChange(String(key) as T)}>
                <Select.Trigger className={selectTriggerClass}>
                    <span className="flex min-w-0 items-center gap-2">
                        {renderPrefix?.(value)}
                        <Select.Value className="truncate" />
                    </span>
                    <Select.Indicator><ChevronDown className="h-4 w-4 text-muted" /></Select.Indicator>
                </Select.Trigger>
                <Select.Popover>
                    <ListBox>
                        {options.map((option) => (
                            <ListBox.Item key={option.id} id={option.id} textValue={option.label} className="rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-default">
                                {option.label}
                            </ListBox.Item>
                        ))}
                    </ListBox>
                </Select.Popover>
            </Select.Root>
        </label>
    );
}

export default function PreferencesPage() {
    const { mode, effective, appearance, setMode, setAppearance, setPreset } = useTheme();

    function updateAppearance<Key extends keyof AppearanceSettings>(key: Key, value: AppearanceSettings[Key]) {
        setAppearance({ ...appearance, [key]: value });
    }

    return (
        <SettingsPage
            group="首选项"
            title="主题设置"
            description="调整界面模式与 HeroUI 组件的全局视觉样式。"
            contentClassName="space-y-5"
        >
            <section className="border-b border-border pb-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">界面模式</h3>
                        <p className="mt-1 text-xs text-muted">当前生效：{effective === "dark" ? "暗色" : "亮色"}</p>
                    </div>
                    <div className="inline-flex gap-1 rounded-field bg-default p-1">
                        {modeOptions.map((option) => {
                            const Icon = option.icon;
                            const selected = mode === option.id;
                            return (
                                <Button
                                    key={option.id}
                                    size="sm"
                                    variant={selected ? "primary" : "ghost"}
                                    className="h-8 min-w-0 gap-1.5 px-3"
                                    onPress={() => setMode(option.id)}
                                >
                                    <Icon className="h-4 w-4" />
                                    {option.label}
                                </Button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section>
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">组件外观</h3>
                    <p className="mt-1 text-xs leading-5 text-muted">这些选项直接配置 HeroUI 的语义颜色、字体和圆角 token。</p>
                </div>

                <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
                    <div className="min-w-52 flex-1 basis-52">
                        <span className={controlLabelClass}>Accent</span>
                        <div className="flex h-10 items-center gap-2 rounded-field border border-[var(--border)] bg-field px-2 shadow-sm">
                            {accentOptions.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-label={option.label}
                                    title={option.label}
                                    className="grid size-6 shrink-0 place-items-center rounded-full transition-transform hover:scale-110"
                                    style={{ backgroundColor: option.color }}
                                    onClick={() => updateAppearance("accent", option.id)}
                                >
                                    {appearance.accent === option.id ? <span className="size-2 rounded-full bg-white shadow-sm" /> : null}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="min-w-44 flex-1 basis-44">
                        <span className={controlLabelClass}>Base</span>
                        <div className="flex h-10 items-center gap-2 rounded-field border border-[var(--border)] bg-field px-2 shadow-sm">
                            {baseOptions.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-label={option.label}
                                    title={option.label}
                                    className="grid size-6 shrink-0 place-items-center rounded-full transition-transform hover:scale-110"
                                    style={{ backgroundColor: option.color }}
                                    onClick={() => updateAppearance("base", option.id)}
                                >
                                    {appearance.base === option.id ? <span className="size-2 rounded-full bg-white shadow-sm" /> : null}
                                </button>
                            ))}
                        </div>
                    </div>

                    <OptionSelect label="Font Family" value={appearance.fontFamily} options={fontOptions} onChange={(value) => updateAppearance("fontFamily", value)} renderPrefix={() => <span className="text-xs text-muted">Aa</span>} />
                    <OptionSelect label="Radius" value={appearance.radius} options={radiusOptions} onChange={(value) => updateAppearance("radius", value)} renderPrefix={(value) => <span className="font-semibold">{radiusOptions.find((item) => item.id === value)?.symbol}</span>} />
                    <OptionSelect label="Radius Form" value={appearance.radiusForm} options={radiusOptions} onChange={(value) => updateAppearance("radiusForm", value)} renderPrefix={(value) => <span className="font-semibold">{radiusOptions.find((item) => item.id === value)?.symbol}</span>} />
                    <OptionSelect label="Theme" value={appearance.preset} options={presetOptions} onChange={setPreset} />
                </div>
            </section>
        </SettingsPage>
    );
}
