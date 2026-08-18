import {
    BookOpen,
    Books,
    CirclePlay,
    Display,
    Gear,
    Ghost,
    FaceRobot,
    MusicNote,
    Picture,
    Snail,
    Stopwatch,
    TrashBin,
} from "@gravity-ui/icons";
import type { ComponentType, SVGProps } from "react";

export interface SidebarItem {
    id: string;
    icon?: ComponentType<SVGProps<SVGSVGElement>>;
    label: string;
    href: string;
    activePrefix?: string;
}

export const SIDEBAR_CONFIG: SidebarItem[] = [
    {
        id: "agent",
        icon: FaceRobot,
        label: "Agent",
        href: "/agent",
    },
    {
        id: "video",
        icon: CirclePlay,
        label: "视频",
        href: "/video",
    },
    {
        id: "manga",
        icon: Books,
        label: "漫画",
        href: "/manga",
    },
    {
        id: "novel",
        icon: BookOpen,
        label: "小说",
        href: "/novel",
    },
    {
        id: "game",
        icon: Ghost,
        label: "游戏",
        href: "/game",
    },
    {
        id: "anime",
        icon: Snail,
        label: "追番",
        href: "/anime",
    },
    {
        id: "movie",
        icon: Display,
        label: "电影",
        href: "/movie",
    },
    {
        id: "music",
        icon: MusicNote,
        label: "音乐",
        href: "/music",
    },
    {
        id: "photo",
        icon: Picture,
        label: "照片",
        href: "/photo",
    },
];

export const SIDEBAR_BOTTOM_CONFIG: SidebarItem[] = [
    {
        id: "recycle-bin",
        icon: TrashBin,
        label: "回收站",
        href: "/recycle-bin",
    },
    {
        id: "tasks",
        icon: Stopwatch,
        label: "任务",
        href: "/tasks",
    },
    {
        id: "settings",
        icon: Gear,
        label: "设置",
        href: "/settings/libraries/list",
        activePrefix: "/settings",
    },
];
