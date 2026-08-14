"use client";

import { Avatar, Card, Chip } from "@heroui/react";
import type { TagResponse } from "@/src/api/client";

type TagCardProps = {
    tag: TagResponse;
    avatarSrc?: string | null;
    backgroundSrc?: string | null;
    onPress: () => void;
};

const BACKGROUND_COLORS = ["#315a6e", "#455c84", "#665d82", "#4d7468", "#776244"];

function backgroundColor(name: string) {
    const value = Array.from(name).reduce((total, character) => total + character.codePointAt(0)!, 0);
    return BACKGROUND_COLORS[value % BACKGROUND_COLORS.length];
}

function fallbackAvatarName(name: string) {
    const characters = Array.from(name.trim());
    return characters.slice(0, 2).join("") || "标";
}

export default function TagCard({
    tag,
    avatarSrc,
    backgroundSrc,
    onPress,
}: TagCardProps) {
    const backgroundStyle = backgroundSrc
        ? { backgroundImage: `url(${backgroundSrc})` }
        : { backgroundColor: backgroundColor(tag.name) };

    return (
        <button type="button" className="w-full min-w-0 text-left" onClick={onPress}>
        <Card.Root className="relative aspect-[2] w-full overflow-hidden transition-transform hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-cover bg-center" style={backgroundStyle} />
            {avatarSrc ? <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url(${avatarSrc})` }} /> : null}
            <Card.Content className="absolute inset-x-0 bottom-0 z-10 !flex !flex-row !items-end !justify-start !gap-3 !p-3">
                <Avatar size="sm" className="!h-11 !w-11 !rounded-lg shrink-0 overflow-hidden [&_img]:!rounded-lg">
                    {avatarSrc ? <Avatar.Image src={avatarSrc} alt={tag.name} className="!h-full !w-full object-cover" /> : null}
                    <Avatar.Fallback className="!rounded-lg text-sm font-semibold">{fallbackAvatarName(tag.name)}</Avatar.Fallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                    <Card.Title className="truncate text-sm text-white">{tag.name}</Card.Title>
                    <Chip size="sm" variant="soft" className="mt-1 bg-black/25 text-white">{tag.resource_count} 个关联资源</Chip>
                </div>
            </Card.Content>
        </Card.Root>
        </button>
    );
}
