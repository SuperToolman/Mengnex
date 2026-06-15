import { client } from "./generated/client.gen";
import {
    createLibrary,
    listLibraries,
    listPhotos,
    listScanTasks,
    startScan,
} from "./generated/sdk.gen";
import type {
    CreateLibraryRequest,
    CreateScanTaskRequest,
    LibraryResponse,
    PhotoAssetResponse,
    ScanTaskResponse,
} from "./generated/types.gen";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";

client.setConfig({
    baseUrl: API_BASE_URL,
    throwOnError: true,
});

export type {
    CreateLibraryRequest,
    CreateScanTaskRequest,
    LibraryResponse,
    PhotoAssetResponse,
    ScanTaskResponse,
};

function unwrapResponse<T>(result: T | { data?: T; error?: unknown }): T {
    if (!result || typeof result !== "object" || !("data" in result || "error" in result)) {
        return result as T;
    }

    if (result.error) {
        throw result.error;
    }

    if (result.data === undefined) {
        throw new Error("API returned an empty response");
    }

    return result.data;
}

export async function getMediaLibraries() {
    return unwrapResponse(await listLibraries({ client }));
}

export async function createMediaLibrary(payload: CreateLibraryRequest) {
    return unwrapResponse(await createLibrary({
        client,
        body: payload,
    }));
}

export async function scanMediaLibrary(payload: CreateScanTaskRequest) {
    return unwrapResponse(await startScan({
        client,
        body: payload,
    }));
}

export async function getScanTasks() {
    return unwrapResponse(await listScanTasks({ client }));
}

export async function getPhotos() {
    const photos = unwrapResponse(await listPhotos({ client }));

    return photos.map((photo) => ({
        ...photo,
        src: photo.src.startsWith("http") ? photo.src : `${API_BASE_URL}${photo.src}`,
    }));
}
