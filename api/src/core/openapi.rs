use utoipa::OpenApi;

use crate::{
    core::health::{self, HealthResponse},
    modules::{
        libraries::{
            dto::{CreateLibraryRequest, LibraryResponse, MediaType},
            handlers as library_handlers,
        },
        media::{
            dto::{MediaFileResponse, MediaItemResponse},
            handlers as media_handlers,
        },
        photos::{dto::PhotoAssetResponse, handlers as photo_handlers},
        scanner::{
            dto::{CreateScanTaskRequest, ScanTaskResponse, ScanTaskStatus},
            handlers as scanner_handlers,
        },
    },
};

#[derive(OpenApi)]
#[openapi(
    paths(
        health::health,
        library_handlers::list_libraries,
        library_handlers::create_library,
        library_handlers::get_library,
        media_handlers::list_media_items,
        media_handlers::list_media_files,
        media_handlers::get_media_file_content,
        photo_handlers::list_photos,
        scanner_handlers::list_scan_tasks,
        scanner_handlers::start_scan,
    ),
    components(schemas(
        HealthResponse,
        MediaType,
        CreateLibraryRequest,
        LibraryResponse,
        MediaItemResponse,
        MediaFileResponse,
        PhotoAssetResponse,
        ScanTaskStatus,
        CreateScanTaskRequest,
        ScanTaskResponse
    )),
    tags(
        (name = "libraries", description = "Media library source directories"),
        (name = "media", description = "Scanned media items and files"),
        (name = "photos", description = "Photo gallery assets"),
        (name = "scanner", description = "Filesystem scan tasks")
    )
)]
pub struct ApiDoc;
