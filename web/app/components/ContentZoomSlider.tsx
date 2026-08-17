"use client";

import { Slider } from "@heroui/react";

type ContentZoomSliderProps = {
    value: number;
    labels: readonly string[];
    onChange: (value: number) => void;
    ariaLabel: string;
    label?: string;
    className?: string;
};

export default function ContentZoomSlider({
    value,
    labels,
    onChange,
    ariaLabel,
    label = "内容",
    className = "w-32",
}: ContentZoomSliderProps) {
    const safeValue = Math.min(Math.max(value, 0), Math.max(labels.length - 1, 0));

    return (
        <div className="flex flex-col gap-1">
            <span className="whitespace-nowrap text-sm text-muted">
                {label}: {labels[safeValue] ?? ""}
            </span>
            <Slider
                aria-label={ariaLabel}
                className={className}
                minValue={0}
                maxValue={Math.max(labels.length - 1, 0)}
                step={1}
                value={safeValue}
                onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue[0] ?? safeValue : nextValue)}
            >
                <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                </Slider.Track>
            </Slider>
        </div>
    );
}
