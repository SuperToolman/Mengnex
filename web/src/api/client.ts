export type MediaType =
    | "photo"
    | "game"
    | "manga"
    | "anime"
    | "movie"
    | "series"
    | "novel"
    | "music"
    | "other";

export type CreateLibraryRequest = {
    name: string;
    media_type: MediaType;
    root_path: string;
    thumbnails_enabled: boolean;
};

export type UpdateLibraryRequest = {
    name?: string;
    root_path?: string;
    enabled?: boolean;
    thumbnails_enabled?: boolean;
};

export type CreateScanTaskRequest = {
    library_id: string;
};

export type ScanTaskResponse = {
    id: string;
    library_id: string;
    status: string;
    discovered_files: number;
    processed_files: number;
    inserted_items: number;
    updated_files: number;
    removed_files: number;
    error_message?: string | null;
    started_at: string;
    finished_at?: string | null;
    created_at: string;
    updated_at: string;
};

export type TaskResponse = {
    id: string;
    kind: "scan_library" | "generate_cache";
    title: string;
    library_id?: string | null;
    library_name?: string | null;
    status: string;
    progress_percent: number;
    processed_items: number;
    total_items: number;
    detail?: string | null;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
    finished_at?: string | null;
};

export type LibraryThumbnailStatusResponse = {
    total_assets: number;
    thumb_ready_assets: number;
    preview_ready_assets: number;
    pending_assets: number;
    thumb_total_bytes: number;
    preview_total_bytes: number;
    last_generated_at?: string | null;
};

export type LibraryThumbnailJobResponse = {
    library_id: string;
    processed_assets: number;
    generated_thumbnails: number;
    generated_previews: number;
    skipped_assets: number;
    deleted_thumbnails: number;
    deleted_previews: number;
    reclaimed_bytes: number;
};

export type ThumbnailGenerationTaskResponse = {
    task_id: string;
    library_id: string;
    status: "queued" | "running" | "completed" | "failed";
    total_assets: number;
    processed_assets: number;
    generated_thumbnails: number;
    generated_previews: number;
    skipped_assets: number;
    progress_percent: number;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
    finished_at?: string | null;
};

export type LibraryResponse = {
    id: string;
    name: string;
    media_type: string;
    root_path: string;
    enabled: boolean;
    thumbnails_enabled: boolean;
    thumbnail_status: LibraryThumbnailStatusResponse;
    created_at: string;
    updated_at: string;
};

export type DeleteLibraryResponse = {
    id: string;
};

export type PhotoAssetResponse = {
    id: string;
    item_id: string;
    file_id: string;
    library_id: string;
    title: string;
    file_name: string;
    src: string;
    original_src: string;
    thumbnail_src?: string | null;
    preview_src?: string | null;
    source_path: string;
    mime_type?: string | null;
    file_size: number;
    width?: number | null;
    height?: number | null;
    taken_at?: string | null;
    batch_time: string;
};

export type ListPhotosParams = {
    limit?: number;
    offset?: number;
};

export type PreferencesResponse = {
    photo_display_source: "thumbnail" | "original";
    created_at: string;
    updated_at: string;
};

export type UpdatePreferencesRequest = {
    photo_display_source: PreferencesResponse["photo_display_source"];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return "Request failed";
}

async function requestJson<T>(
    path: string,
    init?: RequestInit,
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });

    if (!response.ok) {
        let message = `Request failed with status ${response.status}`;

        try {
            const data = await response.json();

            if (data && typeof data === "object" && "message" in data) {
                message = String(data.message);
            }
        } catch {
            // Keep the generic fallback if the response body is not JSON.
        }

        throw new Error(message);
    }

    return response.json() as Promise<T>;
}

function toAbsoluteUrl(url?: string | null) {
    if (!url) {
        return undefined;
    }

    return url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
}

function normalizePhoto(photo: PhotoAssetResponse): PhotoAssetResponse {
    return {
        ...photo,
        src: toAbsoluteUrl(photo.src) ?? photo.src,
        original_src: toAbsoluteUrl(photo.original_src) ?? photo.original_src,
        thumbnail_src: toAbsoluteUrl(photo.thumbnail_src),
        preview_src: toAbsoluteUrl(photo.preview_src),
    };
}

export async function getMediaLibraries() {
    return requestJson<LibraryResponse[]>("/api/libraries");
}

export async function createMediaLibrary(payload: CreateLibraryRequest) {
    return requestJson<LibraryResponse>("/api/libraries", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function updateMediaLibrary(
    libraryId: string,
    payload: UpdateLibraryRequest,
) {
    return requestJson<LibraryResponse>(`/api/libraries/${libraryId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export async function deleteMediaLibrary(libraryId: string) {
    return requestJson<DeleteLibraryResponse>(`/api/libraries/${libraryId}`, {
        method: "DELETE",
    });
}

export async function updateLibraryThumbnailConfig(
    libraryId: string,
    thumbnailsEnabled: boolean,
) {
    return requestJson<LibraryResponse>(`/api/libraries/${libraryId}/thumbnails/settings`, {
        method: "PUT",
        body: JSON.stringify({
            thumbnails_enabled: thumbnailsEnabled,
        }),
    });
}

export async function generateLibraryThumbnails(libraryId: string) {
    return requestJson<ThumbnailGenerationTaskResponse>(
        `/api/libraries/${libraryId}/thumbnails/generate`,
        {
            method: "POST",
        },
    );
}

export async function getLibraryThumbnailGenerationTask(
    libraryId: string,
    taskId: string,
) {
    return requestJson<ThumbnailGenerationTaskResponse>(
        `/api/libraries/${libraryId}/thumbnails/tasks/${taskId}`,
    );
}

export async function deleteLibraryThumbnails(libraryId: string) {
    return requestJson<LibraryThumbnailJobResponse>(
        `/api/libraries/${libraryId}/thumbnails`,
        {
            method: "DELETE",
        },
    );
}

export async function scanMediaLibrary(payload: CreateScanTaskRequest) {
    return requestJson<ScanTaskResponse>("/api/scans", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function getScanTasks() {
    return requestJson<ScanTaskResponse[]>("/api/scans");
}

export async function getTasks() {
    return requestJson<TaskResponse[]>("/api/tasks");
}

export async function pauseTask(taskId: string) {
    return requestJson<TaskResponse>(`/api/tasks/${taskId}/pause`, {
        method: "POST",
    });
}

export async function resumeTask(taskId: string) {
    return requestJson<TaskResponse>(`/api/tasks/${taskId}/resume`, {
        method: "POST",
    });
}

export async function cancelTask(taskId: string) {
    return requestJson<TaskResponse>(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
    });
}

export async function getPhotos(params?: ListPhotosParams) {
    const query = new URLSearchParams();

    if (typeof params?.limit === "number") {
        query.set("limit", String(params.limit));
    }

    if (typeof params?.offset === "number") {
        query.set("offset", String(params.offset));
    }

    const path = query.size > 0 ? `/api/photos?${query.toString()}` : "/api/photos";
    const photos = await requestJson<PhotoAssetResponse[]>(path);
    return photos.map(normalizePhoto);
}

export async function getPreferences() {
    return requestJson<PreferencesResponse>("/api/preferences");
}

export async function updatePreferences(payload: UpdatePreferencesRequest) {
    try {
        return await requestJson<PreferencesResponse>("/api/preferences", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
}

export { API_BASE_URL };
