use utoipa::OpenApi;

use crate::{
    core::health::{self, HealthResponse},
    modules::{
        libraries::{
            dto::{
                CreateLibraryRequest, DeleteLibraryResponse, LibraryResponse, LibraryThumbnailJobResponse,
                LibraryThumbnailStatusResponse, MediaType, ThumbnailGenerationTaskResponse,
                ThumbnailGenerationTaskStatus, UpdateLibraryRequest,
                UpdateLibraryThumbnailConfigRequest,
            },
            handlers as library_handlers,
        },
        media::{
            dto::{MediaFileResponse, MediaItemResponse},
            handlers as media_handlers,
        },
        photos::{dto::{DeletePhotoResponse, PhotoAssetResponse}, handlers as photo_handlers},
        preferences::{
            dto::{PreferencesResponse, UpdatePreferencesRequest},
            handlers as preference_handlers,
        },
        scanner::{
            dto::{CreateScanTaskRequest, ScanTaskResponse, ScanTaskStatus},
            handlers as scanner_handlers,
        },
        tasks::{dto::{TaskResponse, TaskStatus}, handlers as task_handlers},
    },
};

#[derive(OpenApi)]
#[openapi(
    paths(
        health::health,
        library_handlers::list_libraries,
        library_handlers::create_library,
        library_handlers::get_library,
        library_handlers::update_library,
        library_handlers::delete_library,
        library_handlers::update_library_thumbnail_config,
        library_handlers::generate_library_thumbnail_assets,
        library_handlers::get_library_thumbnail_generation_task,
        library_handlers::delete_library_thumbnail_assets,
        media_handlers::list_media_items,
        media_handlers::list_media_files,
        media_handlers::get_media_file_content,
        photo_handlers::list_photos,
        photo_handlers::delete_photo,
        preference_handlers::get_preferences,
        preference_handlers::update_preferences,
        scanner_handlers::list_scan_tasks,
        scanner_handlers::start_scan,
        task_handlers::list_tasks,
        task_handlers::pause_task,
        task_handlers::resume_task,
        task_handlers::cancel_task,
    ),
    components(schemas(
        HealthResponse,
        MediaType,
        CreateLibraryRequest,
        UpdateLibraryRequest,
        UpdateLibraryThumbnailConfigRequest,
        DeleteLibraryResponse,
        LibraryResponse,
        LibraryThumbnailStatusResponse,
        LibraryThumbnailJobResponse,
        ThumbnailGenerationTaskStatus,
        ThumbnailGenerationTaskResponse,
        MediaItemResponse,
        MediaFileResponse,
        PhotoAssetResponse,
        DeletePhotoResponse,
        PreferencesResponse,
        UpdatePreferencesRequest,
        ScanTaskStatus,
        CreateScanTaskRequest,
        ScanTaskResponse,
        TaskStatus,
        TaskResponse
    )),
    tags(
        (name = "libraries", description = "Media library source directories"),
        (name = "media", description = "Scanned media items and files"),
        (name = "photos", description = "Photo gallery assets"),
        (name = "preferences", description = "Application preferences"),
        (name = "scanner", description = "Filesystem scan tasks"),
        (name = "tasks", description = "Unified application task feed")
    )
)]
pub struct ApiDoc;
