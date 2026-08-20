"use client";

import { Tooltip } from "@heroui/react";
import { CircleInfo } from "@gravity-ui/icons";
import type { CSSProperties, ReactNode } from "react";

type InfoTooltipProps = {
    size?: CSSProperties["width"];
    content: ReactNode;
};

export default function InfoTooltip({ size = "1.25rem", content }: InfoTooltipProps) {
    const iconStyle: CSSProperties = { width: size, height: size };

    return (
        <Tooltip delay={0}>
            <Tooltip.Trigger className="inline-flex h-auto w-auto shrink-0" aria-label="更多信息">
                <CircleInfo style={iconStyle} />
            </Tooltip.Trigger>
            <Tooltip.Content>{content}</Tooltip.Content>
        </Tooltip>
    );
}
