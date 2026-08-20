"use client";

import { Label, ListBox, Select, Surface } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";

export type OptionMenuItem<T extends string> = {
    /** 选项唯一值。 */
    id: T;
    /** 选项名称，同时作为触发器中展示的已选值。 */
    label: string;
    /** 默认选项内容下展示的辅助说明。 */
    description?: string;
    /** 选项预览使用的字体，例如字体选择菜单。 */
    fontFamily?: string;
    /** 覆盖该项的 HeroUI Surface 变体。 */
    surfaceVariant?: "default" | "secondary" | "tertiary" | "transparent";
    /** 应用于选项预览 Surface 的内联样式。 */
    surfaceStyle?: CSSProperties;
    /** 追加到选项预览 Surface 的类名。 */
    itemClassName?: string;
};

type OptionMenuProps<T extends string> = {
    /** 可见字段标题，也会作为无障碍名称。 */
    label: string;
    /** 打开菜单后显示在标题下方的说明。 */
    description?: string;
    /** 当前选中的选项 id。 */
    value: T;
    /** 菜单选项；每项可按需定义自己的预览样式。 */
    options: Array<OptionMenuItem<T>>;
    /** 用户选择新选项时触发。 */
    onChange: (value: T) => void;
    /** 触发器左侧的可选内容。 */
    prefix?: ReactNode;
    /** 自定义每个选项的内容；未提供时使用标签和说明的默认布局。 */
    renderOption?: (option: OptionMenuItem<T>, selected: boolean) => ReactNode;
    /** 所有未单独定义变体的选项使用的 Surface 变体。 */
    surfaceVariant?: "default" | "secondary" | "tertiary" | "transparent";
    /** 是否禁用整个菜单。 */
    isDisabled?: boolean;
    /** 组件根节点的布局类名。 */
    className?: string;
};

export default function OptionMenu<T extends string>({
    label,
    description,
    value,
    options,
    onChange,
    prefix,
    renderOption,
    surfaceVariant = "default",
    isDisabled = false,
    className = "w-44",
}: OptionMenuProps<T>) {
    const selected = options.find((option) => option.id === value) ?? options[0];

    return (
        <Select.Root
            aria-label={label}
            selectedKey={value}
            onSelectionChange={(key) => key != null && onChange(String(key) as T)}
            isDisabled={isDisabled}
            className={className}
        >
            <Label>{label}</Label>
            <Select.Trigger aria-label={label} className={`input flex h-10 min-w-0 justify-between gap-3 ${isDisabled ? "cursor-not-allowed opacity-70" : ""}`}>
                {prefix ? <span className="shrink-0 text-muted">{prefix}</span> : null}
                <Select.Value className="min-w-0 truncate text-left text-foreground">{selected?.label ?? value}</Select.Value>
                <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="z-50 w-[min(24rem,calc(100vw-2rem))] p-3">
                <div className="px-1 pb-3">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
                </div>
                <ListBox aria-label={`${label}选项`} className="grid grid-cols-3 gap-2 p-0">
                    {options.map((option) => {
                        const isSelected = option.id === value;
                        const optionStyle = {
                            ...(option.fontFamily ? { fontFamily: option.fontFamily } : {}),
                            ...option.surfaceStyle,
                        };

                        return (
                            <ListBox.Item
                                key={option.id}
                                id={option.id}
                                textValue={option.label}
                                style={optionStyle}
                                className="!bg-transparent flex min-h-20 min-w-0 p-0 text-center outline-none transition hover:!bg-transparent data-[hovered=true]:!bg-transparent data-[selected=true]:!bg-transparent aria-selected:!bg-transparent data-[focused=true]:outline-none"
                            >
                                <Surface
                                    variant={option.surfaceVariant ?? surfaceVariant}
                                    className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl transition-shadow hover:shadow-sm ${option.itemClassName ?? ""}`}
                                    style={optionStyle}
                                >
                                    {renderOption ? renderOption(option, isSelected) : <>
                                        <span className="block text-sm font-semibold text-current">{option.label}</span>
                                        {option.description ? <span className="mt-1 block text-xs text-muted">{option.description}</span> : null}
                                    </>}
                                </Surface>
                            </ListBox.Item>
                        );
                    })}
                </ListBox>
            </Select.Popover>
        </Select.Root>
    );
}
