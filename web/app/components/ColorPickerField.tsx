"use client";

import { Shuffle } from "@gravity-ui/icons";
import type { ColorChannel } from "@heroui/react";
import { Button, ColorArea, ColorField, ColorPicker, ColorSlider, ColorSwatch, ColorSwatchPicker, Label, ListBox, Select, Tooltip } from "@heroui/react";
import { useState } from "react";

const colorChannelsBySpace: Record<"hsb" | "hsl" | "rgb", ColorChannel[]> = {
    hsb: ["hue", "saturation", "brightness"],
    hsl: ["hue", "saturation", "lightness"],
    rgb: ["red", "green", "blue"],
};

type ColorPickerFieldProps = {
    label: string;
    value: string;
    swatches: string[];
    onChange: (value: string) => void;
};

export default function ColorPickerField({ label, value, swatches, onChange }: ColorPickerFieldProps) {
    const [colorSpace, setColorSpace] = useState<"hsb" | "hsl" | "rgb">("rgb");

    return (
        <ColorPicker aria-label={label} value={value} onChange={(color) => onChange(color.toString("hex"))}>
            <ColorPicker.Trigger aria-label={label}>
                <ColorSwatch size="lg" />
                <span className="min-w-0 flex-1">
                    <Label className="block text-sm font-medium text-foreground">{label}</Label>
                    <span className="mt-0.5 block text-xs text-muted">Selected: {value.toUpperCase()}</span>
                </span>
            </ColorPicker.Trigger>
            <ColorPicker.Popover style={{ width: 250 }}>
                <ColorArea aria-label={`${label}颜色区域`} colorSpace="hsb" xChannel="saturation" yChannel="brightness">
                    <ColorArea.Thumb />
                </ColorArea>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ColorSlider aria-label={`${label}色相`} style={{ flex: 1, minWidth: 0 }} channel="hue" colorSpace="hsb">
                        <ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track>
                    </ColorSlider>
                    <Tooltip>
                        <Tooltip.Trigger>
                            <Button isIconOnly size="sm" variant="secondary" aria-label="生成随机颜色" onPress={() => onChange(`#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`)}>
                                <Shuffle className="h-4 w-4" />
                            </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>随机颜色</Tooltip.Content>
                    </Tooltip>
                </div>
                <ColorSwatchPicker aria-label={`${label}色板`} size="xs">
                    {swatches.map((color) => <ColorSwatchPicker.Item key={color} color={color}><ColorSwatchPicker.Swatch /></ColorSwatchPicker.Item>)}
                </ColorSwatchPicker>
                <Select.Root aria-label="色彩通道" selectedKey={colorSpace} onSelectionChange={(key) => setColorSpace(String(key) as "hsb" | "hsl" | "rgb")}>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>{Object.keys(colorChannelsBySpace).map((space) => <ListBox.Item key={space} id={space} textValue={space}>{space.toUpperCase()}</ListBox.Item>)}</ListBox></Select.Popover>
                </Select.Root>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    {colorChannelsBySpace[colorSpace].map((channel) => <ColorField key={channel} aria-label={channel} channel={channel} colorSpace={colorSpace}><ColorField.Group variant="secondary"><ColorField.Input /></ColorField.Group></ColorField>)}
                </div>
            </ColorPicker.Popover>
        </ColorPicker>
    );
}
