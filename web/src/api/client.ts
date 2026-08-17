import { client as generatedClient } from "./generated/client.gen";
import {
    cancelTask as cancelTaskSdk,
    clearCompletedTasks as clearCompletedTasksSdk,
    clearTags as clearTagsSdk,
    createTag as createTagSdk,
    createLibrary as createLibrarySdk,
    create as createWebdavConnectionSdk,
    createUser as createUserSdk,
    deleteLibrary as deleteLibrarySdk,
    deleteTask as deleteTaskSdk,
    deleteLibraryPreviewAssets,
    deletePhoto as deletePhotoSdk,
    deleteTag as deleteTagSdk,
    generateLibraryPreviewAssets,
    getLibraryPreviewGenerationTask as getLibraryPreviewGenerationTaskSdk,
    getAuthor as getAuthorSdk,
    getPreferences as getPreferencesSdk,
    getReader,
    getSeries,
    getVideo as getVideoSdk,
    listLibraries,
    listAuthors,
    listSeries,
    list as listWebdavConnectionsSdk,
    listFolderContents,
    listPhotos,
    listRecycleBin,
    listResourceTags,
    listRolePermissions,
    listScanTasks,
    listTasks,
    listVideos,
    listVideoCatalog,
    listTagResources as listTagResourcesSdk,
    listTags as listTagsSdk,
    listUsers,
    login as loginSdk,
    logout as logoutSdk,
    me,
    pauseTask as pauseTaskSdk,
    purgeItem,
    restoreItem,
    resumeTask as resumeTaskSdk,
    retryTask as retryTaskSdk,
    setup as setupSdk,
    replaceResourceTags,
    startScan,
    status,
    taskSummary as taskSummarySdk,
    updateLibrary as updateLibrarySdk,
    updateLibraryPreviewConfig as updateLibraryPreviewConfigSdk,
    updatePreferences as updatePreferencesSdk,
    updateTag as updateTagSdk,
    updatePlayback as updateVideoPlaybackSdk,
} from "./generated/sdk.gen";
import type {
    AuthRole,
    AuthorResponse,
    AuthorDetailResponse,
    AuthorAvatarResponse,
    CreateLibraryRequest,
    CreateUserRequest,
    CredentialsRequest,
    CreateScanTaskRequest,
    DeleteLibraryResponse,
    DeletePhotoResponse,
    LibraryResponse,
    LibraryPreviewJobResponse,
    LibraryPreviewStatusResponse,
    MediaType,
    MangaDetailResponse,
    MangaReaderResponse,
    MangaSeriesResponse,
    PhotoAssetResponse,
    PhotoFolderContentsResponse,
    PhotoFolderResponse,
    PreferencesResponse,
    RecycleBinItemResponse,
    RolePermissionsResponse,
    ScanTaskResponse,
    SetupRequest,
    TaskResponse,
    TaskSummaryResponse,
    TagResponse,
    TagResourceResponse,
    PreviewGenerationTaskResponse,
    UpdateLibraryRequest,
    UpdatePreferencesRequest,
    UpdateTagRequest,
    CreateWebdavConnectionRequest,
    WebdavConnectionResponse,
    UserResponse,
    VideoAssetResponse,
    VideoCoverJobResponse,
    VideoCatalogResponse,
    VideoDetailResponse,
    VideoPlaybackResponse,
    UpdateVideoPlaybackRequest,
} from "./generated/types.gen";

export type {
    AuthRole,
    AuthorResponse,
    AuthorDetailResponse,
    AuthorAvatarResponse,
    CreateLibraryRequest,
    CreateUserRequest,
    CredentialsRequest,
    CreateScanTaskRequest,
    DeleteLibraryResponse,
    DeletePhotoResponse,
    LibraryResponse,
    LibraryPreviewJobResponse,
    LibraryPreviewStatusResponse,
    MediaType,
    MangaDetailResponse,
    MangaReaderResponse,
    MangaSeriesResponse,
    PhotoAssetResponse,
    PhotoFolderContentsResponse,
    PhotoFolderResponse,
    PreferencesResponse,
    RecycleBinItemResponse,
    ScanTaskResponse,
    TaskResponse,
    TaskSummaryResponse,
    TagResponse,
    TagResourceResponse,
    PreviewGenerationTaskResponse,
    UpdateLibraryRequest,
    UpdatePreferencesRequest,
    UpdateTagRequest,
    VideoAssetResponse,
    VideoCoverJobResponse,
    VideoCatalogResponse,
    VideoDetailResponse,
    VideoPlaybackResponse,
    UpdateVideoPlaybackRequest,
};

export type AuthUser = UserResponse;
export type RolePermissions = RolePermissionsResponse;
export type { WebdavConnectionResponse, CreateWebdavConnectionRequest };
export type ListPhotosParams = { limit?: number; offset?: number; beforeId?: string; libraryId?: string };
export type ListPhotoFolderContentsParams = { path?: string; limit?: number; offset?: number };
export type ListVideosParams = { libraryId?: string; limit?: number; offset?: number };
export type VideoCatalogParams = ListVideosParams & {
    search?: string;
    sort?: "created" | "title" | "duration" | "updated";
    order?: "asc" | "desc";
    watched?: "all" | "unwatched" | "in_progress" | "completed";
};
export type LibraryCoversResponse = {
    photos: PhotoAssetResponse[];
    videos: VideoAssetResponse[];
};

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const sdkOptions = { throwOnError: true as const };

generatedClient.setConfig({
    baseUrl: API_BASE_URL,
    credentials: "include",
});

generatedClient.interceptors.response.use((response) => {
    if (response.status === 401 && typeof window !== "undefined") {
        const path = new URL(response.url).pathname;
        if (!path.startsWith("/api/auth/")) window.location.assign("/login");
    }
    return response;
});

async function execute<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof Error) {
            if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
                throw new Error("无法连接 API 服务，请先启动后端服务");
            }
            throw error;
        }
        if (error && typeof error === "object" && "message" in error) {
            throw new Error(String(error.message));
        }
        throw new Error("API 请求失败，请检查后端服务日志");
    }
}

function toAbsoluteUrl(url?: string | null) {
    if (!url) return undefined;
    return url.startsWith("http") || !API_BASE_URL ? url : `${API_BASE_URL}${url}`;
}

function normalizePhoto(photo: PhotoAssetResponse): PhotoAssetResponse {
    return {
        ...photo,
        src: toAbsoluteUrl(photo.src) ?? photo.src,
        original_src: toAbsoluteUrl(photo.original_src) ?? photo.original_src,
        preview_src: toAbsoluteUrl(photo.preview_src),
    };
}

export async function getMediaLibraries() {
    return execute(listLibraries(sdkOptions));
}
export async function getAuthors() { return execute(listAuthors(sdkOptions)); }
export async function getTags(query?: string) {
    return execute(listTagsSdk({ ...sdkOptions, query: { query } }));
}
export async function getTagResources(tagId: string) {
    return execute<TagResourceResponse[]>(listTagResourcesSdk({ ...sdkOptions, path: { id: tagId } }));
}
export async function createTag(name: string) {
    return execute(createTagSdk({ ...sdkOptions, body: { name } }));
}
export async function updateTag(tagId: string, payload: UpdateTagRequest) {
    return execute(updateTagSdk({ ...sdkOptions, path: { id: tagId }, body: payload }));
}
export async function deleteTag(tagId: string) {
    return execute(deleteTagSdk({ ...sdkOptions, path: { id: tagId } }));
}
export async function clearTags() { return execute(clearTagsSdk(sdkOptions)); }
export async function uploadTagAvatar(tagId: string, file: File) {
    const response = await fetch(`${API_BASE_URL}/api/tags/${tagId}/avatar`, { method: "PUT", credentials: "include", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "头像上传失败");
    return response.json() as Promise<TagResponse>;
}
export async function getResourceTags(resourceType: string, resourceId: string) {
    return execute(listResourceTags({ ...sdkOptions, path: { resource_type: resourceType, resource_id: resourceId } }));
}
export async function replaceTagsForResource(resourceType: string, resourceId: string, tagIds: string[]) {
    return execute(replaceResourceTags({ ...sdkOptions, path: { resource_type: resourceType, resource_id: resourceId }, body: { tag_ids: tagIds } }));
}
export async function getAuthor(authorId: string) {
    const author = await execute(getAuthorSdk({ ...sdkOptions, path: { id: authorId } }));
    return { ...author, avatar_src: toAbsoluteUrl(author.avatar_src) };
}
export async function uploadAuthorAvatar(authorId: string, file: File) {
    const response = await fetch(`${API_BASE_URL}/api/authors/${authorId}/avatar`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "头像上传失败");
    return response.json() as Promise<AuthorResponse>;
}
export async function selectAuthorAvatar(authorId: string, avatarId: string) {
    const response = await fetch(`${API_BASE_URL}/api/authors/${authorId}/avatars/${avatarId}/select`, { method: "PUT", credentials: "include" });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "头像切换失败");
    return response.json() as Promise<AuthorResponse>;
}
export async function deleteAuthorAvatar(authorId: string, avatarId: string) {
    const response = await fetch(`${API_BASE_URL}/api/authors/${authorId}/avatars/${avatarId}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "头像删除失败");
    return response.json() as Promise<AuthorResponse>;
}

export async function createMediaLibrary(payload: CreateLibraryRequest) {
    return execute(createLibrarySdk({ ...sdkOptions, body: payload }));
}

export async function getWebdavConnections() {
    return execute<WebdavConnectionResponse[]>(listWebdavConnectionsSdk(sdkOptions));
}

export async function createWebdavConnection(payload: CreateWebdavConnectionRequest) {
    return execute<WebdavConnectionResponse>(createWebdavConnectionSdk({ ...sdkOptions, body: payload }));
}

export async function updateMediaLibrary(libraryId: string, payload: UpdateLibraryRequest) {
    return execute(updateLibrarySdk({ ...sdkOptions, path: { id: libraryId }, body: payload }));
}

export async function deleteMediaLibrary(libraryId: string) {
    return execute(deleteLibrarySdk({ ...sdkOptions, path: { id: libraryId } }));
}

export async function updateLibraryPreviewConfig(libraryId: string, previewsEnabled: boolean) {
    return execute(updateLibraryPreviewConfigSdk({ ...sdkOptions, path: { id: libraryId }, body: { previews_enabled: previewsEnabled } }));
}

export async function generateLibraryPreviews(libraryId: string) {
    return execute(generateLibraryPreviewAssets({ ...sdkOptions, path: { id: libraryId } }));
}

export async function getLibraryPreviewGenerationTask(libraryId: string, taskId: string) {
    return execute(getLibraryPreviewGenerationTaskSdk({ ...sdkOptions, path: { id: libraryId, task_id: taskId } }));
}

export async function deleteLibraryPreviews(libraryId: string) {
    return execute(deleteLibraryPreviewAssets({ ...sdkOptions, path: { id: libraryId } }));
}

export async function scanMediaLibrary(payload: CreateScanTaskRequest) {
    return execute(startScan({ ...sdkOptions, body: payload }));
}

export async function getScanTasks() {
    return execute(listScanTasks(sdkOptions));
}

export async function getTasks(active?: boolean) {
    return execute(listTasks({ ...sdkOptions, query: active === undefined ? undefined : { active } }));
}

export async function getTaskSummary() {
    return execute(taskSummarySdk(sdkOptions));
}

export async function getLibraryCovers() {
    const response = await fetch(`${API_BASE_URL}/api/libraries/covers`, {
        credentials: "include",
    });
    if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.message ?? "无法加载媒体库封面");
    }
    const covers = await response.json() as LibraryCoversResponse;
    return {
        photos: covers.photos.map(normalizePhoto),
        videos: covers.videos.map(normalizeVideo),
    };
}

export async function pauseTask(taskId: string) {
    return execute(pauseTaskSdk({ ...sdkOptions, path: { id: taskId } }));
}

export async function resumeTask(taskId: string) {
    return execute(resumeTaskSdk({ ...sdkOptions, path: { id: taskId } }));
}

export async function retryTask(taskId: string) {
    return execute(retryTaskSdk({ ...sdkOptions, path: { id: taskId } }));
}

export async function cancelTask(taskId: string) {
    return execute(cancelTaskSdk({ ...sdkOptions, path: { id: taskId } }));
}

export async function deleteTask(taskId: string) {
    return execute(deleteTaskSdk({ ...sdkOptions, path: { id: taskId } }));
}

export async function clearCompletedTasks() {
    return execute(clearCompletedTasksSdk(sdkOptions));
}

export async function getPhotos(params?: ListPhotosParams) {
    const photos = await execute(listPhotos({
        ...sdkOptions,
        query: {
            limit: params?.limit,
            offset: params?.offset,
            before_id: params?.beforeId,
            library_id: params?.libraryId,
        },
    }));
    return photos.map(normalizePhoto);
}

export async function getVideos(params?: ListVideosParams) {
    const videos = await execute(listVideos({
        ...sdkOptions,
        query: {
            library_id: params?.libraryId,
            limit: params?.limit,
            offset: params?.offset,
        },
    }));
    return videos.map((video) => ({
        ...video,
        stream_src: toAbsoluteUrl(video.stream_src) ?? video.stream_src,
        poster_src: toAbsoluteUrl(video.poster_src),
    }));
}

function normalizeVideo<T extends VideoAssetResponse>(video: T): T {
    return {
        ...video,
        stream_src: toAbsoluteUrl(video.stream_src) ?? video.stream_src,
        poster_src: toAbsoluteUrl(video.poster_src),
    };
}

export async function getVideoCatalog(params?: VideoCatalogParams) {
    const catalog = await execute(listVideoCatalog({
        ...sdkOptions,
        query: {
            library_id: params?.libraryId,
            search: params?.search,
            sort: params?.sort,
            order: params?.order,
            watched: params?.watched === "all" ? undefined : params?.watched,
            limit: params?.limit,
            offset: params?.offset,
        },
    }));
    return { ...catalog, items: catalog.items.map(normalizeVideo) };
}

export async function getVideo(id: string) {
    const detail = await execute(getVideoSdk({ ...sdkOptions, path: { id } }));
    return normalizeVideo(detail);
}

export async function updateVideoPlayback(id: string, body: UpdateVideoPlaybackRequest) {
    return execute(updateVideoPlaybackSdk({ ...sdkOptions, path: { id }, body }));
}

export async function deleteVideoCovers(libraryId: string) {
    const response = await fetch(`${API_BASE_URL}/api/videos/covers/${libraryId}`, {
        method: "DELETE",
        credentials: "include",
    });
    if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.message ?? "无法清理视频封面");
    }
    return response.json() as Promise<VideoCoverJobResponse>;
}

export async function getMangaSeries() {
    const series = await execute(listSeries(sdkOptions));
    return series.map((item) => ({
        ...item,
        cover_src: toAbsoluteUrl(item.cover_src),
    }));
}
export async function getMangaDetail(id: string) { return execute(getSeries({ ...sdkOptions, path: { id } })); }
export async function getMangaReader(chapterId: string) { return execute(getReader({ ...sdkOptions, path: { id: chapterId } })); }

export async function getPhotoFolderContents(
    libraryId: string,
    params?: ListPhotoFolderContentsParams,
) {
    const contents = await execute(listFolderContents({
        ...sdkOptions,
        path: { library_id: libraryId },
        query: {
            path: params?.path,
            limit: params?.limit,
            offset: params?.offset,
        },
    }));

    return {
        ...contents,
        folders: contents.folders.map((folder) => ({
            ...folder,
            cover: folder.cover ? normalizePhoto(folder.cover) : null,
        })),
        photos: contents.photos.map(normalizePhoto),
    };
}

export async function deletePhoto(photoId: string) {
    return execute(deletePhotoSdk({ ...sdkOptions, path: { photo_id: photoId } }));
}

export async function getRecycleBinItems() {
    const items = await execute(listRecycleBin(sdkOptions));
    return items.map((item) => ({ ...item, image_src: toAbsoluteUrl(item.image_src) }));
}

export async function restoreRecycleBinItem(itemId: string) {
    return execute(restoreItem({ ...sdkOptions, path: { item_id: itemId } }));
}

export async function purgeRecycleBinItem(itemId: string) {
    return execute(purgeItem({ ...sdkOptions, path: { item_id: itemId } }));
}

export async function getAuthStatus() {
    return execute(status(sdkOptions));
}

export async function login(payload: CredentialsRequest) {
    const result = await execute(loginSdk({ ...sdkOptions, body: payload }));
    return result;
}

export async function setupApplication(payload: SetupRequest) {
    return execute(setupSdk({ ...sdkOptions, body: payload }));
}

export async function logout() {
    return execute(logoutSdk(sdkOptions));
}

export async function getCurrentUser() {
    return execute(me(sdkOptions));
}

export async function getUsers() {
    return execute(listUsers(sdkOptions));
}

export async function createUser(payload: CreateUserRequest) {
    return execute(createUserSdk({ ...sdkOptions, body: payload }));
}

export async function getRolePermissions() {
    return execute(listRolePermissions(sdkOptions));
}

export async function getPreferences() {
    return execute(getPreferencesSdk(sdkOptions));
}

export async function updatePreferences(payload: UpdatePreferencesRequest) {
    return execute(updatePreferencesSdk({ ...sdkOptions, body: payload }));
}
