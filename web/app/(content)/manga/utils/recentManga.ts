import type { MangaSeriesResponse } from "@/src/api/client";

const STORAGE_KEY = "mengnex.manga.recent-reading";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type RecentMangaEntry = {
    mangaId: string;
    readAt: number;
};

type MangaProgress = {
    chapterId: string;
    pageIndex: number;
    updatedAt: number;
};

const PROGRESS_KEY = "mengnex.manga.reading-progress";

function readEntries() {
    if (typeof window === "undefined") {
        return [] as RecentMangaEntry[];
    }

    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
        if (!Array.isArray(value)) return [];

        const cutoff = Date.now() - RETENTION_MS;
        const entries = value.filter((entry): entry is RecentMangaEntry => (
            typeof entry === "object"
            && entry !== null
            && "mangaId" in entry
            && "readAt" in entry
            && typeof entry.mangaId === "string"
            && typeof entry.readAt === "number"
            && entry.readAt >= cutoff
        ));

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        return entries;
    } catch {
        return [];
    }
}

export function recordMangaReading(mangaId: string) {
    const entries = readEntries().filter((entry) => entry.mangaId !== mangaId);
    entries.unshift({ mangaId, readAt: Date.now() });

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Reading history is optional and must never block the reader.
    }
}

export function getRecentMangaSeries(series: MangaSeriesResponse[]) {
    const seriesById = new Map(series.map((item) => [item.id, item]));
    return readEntries()
        .sort((left, right) => right.readAt - left.readAt)
        .flatMap((entry) => {
            const manga = seriesById.get(entry.mangaId);
            return manga ? [manga] : [];
        });
}

export function getMangaProgress(seriesId: string): MangaProgress | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        const values: Record<string, MangaProgress> = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "{}");
        const value = values[seriesId];
        return value && typeof value.chapterId === "string" && Number.isInteger(value.pageIndex) ? value : undefined;
    } catch {
        return undefined;
    }
}

export function recordMangaProgress(seriesId: string, chapterId: string, pageIndex: number) {
    if (typeof window === "undefined") return;
    try {
        const values: Record<string, MangaProgress> = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "{}");
        values[seriesId] = { chapterId, pageIndex: Math.max(0, pageIndex), updatedAt: Date.now() };
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(values));
    } catch {
        // Reading progress is an enhancement and must never interrupt reading.
    }
}
