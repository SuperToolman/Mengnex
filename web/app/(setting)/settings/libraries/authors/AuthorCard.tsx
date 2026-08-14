import { Avatar, Button, Card, Chip } from "@heroui/react";
import type { AuthorResponse } from "@/src/api/client";

const RESOURCE_TYPE_LABELS: Record<string, string> = { manga_series: "漫画", photo_asset: "照片" };
const RESOURCE_TYPE_COLORS = { manga_series: "accent", photo_asset: "success" } as const;

function fallbackAvatarName(name: string) {
    const characters = Array.from(name.trim());
    const displayName = characters.length > 8 ? `${characters.slice(0, 8).join("")}…` : characters.join("");
    const fontSize = characters.length <= 2 ? "text-xl" : characters.length <= 4 ? "text-base" : characters.length <= 6 ? "text-sm" : "text-xs";
    return { displayName, fontSize };
}

export default function AuthorCard({ author, onPress }: { author: AuthorResponse; onPress: () => void }) {
    const fallback = fallbackAvatarName(author.name);

    return (
        <Button variant="ghost" className="group h-auto w-full min-w-0 p-0 text-left" onPress={onPress}>
            <Card.Root className="relative aspect-video w-full overflow-hidden transition-transform group-hover:-translate-y-0.5">
                {author.avatar_src ? <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${author.avatar_src})` }} /> : null}
                <Card.Content className="absolute inset-x-0 bottom-0 z-10 flex flex-row items-end justify-start gap-3 p-4">
                    <Avatar aria-label={author.name} size="lg" className="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg [&_img]:rounded-lg">
                        {author.avatar_src ? <Avatar.Image src={author.avatar_src} alt={author.name} className="h-full w-full object-cover" /> : null}
                        <Avatar.Fallback className={`rounded-lg px-1 text-center leading-tight whitespace-normal break-all ${fallback.fontSize}`}>{fallback.displayName}</Avatar.Fallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 text-left">
                        <Card.Title className="whitespace-nowrap truncate text-base text-white">{author.name}</Card.Title>
                        <Card.Description className="text-white/75">{author.resource_count} 个关联资源</Card.Description>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {author.resource_types.map((type) => <Chip key={type} size="sm" variant="soft" color={RESOURCE_TYPE_COLORS[type as keyof typeof RESOURCE_TYPE_COLORS] ?? "default"}>{RESOURCE_TYPE_LABELS[type] ?? type}</Chip>)}
                        </div>
                    </div>
                </Card.Content>
            </Card.Root>
        </Button>
    );
}
