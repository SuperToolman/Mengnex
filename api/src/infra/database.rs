use std::{collections::HashSet, env, fs, path::PathBuf};

use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, Database, DatabaseConnection, DbBackend, DbErr,
    EntityTrait, PaginatorTrait, QueryFilter, Schema, Set, Statement,
};

use crate::infra::entities::{
    app_setting, app_task, app_user, auth_session, author, author_avatar, author_resource,
    manga_chapter, manga_page, manga_series, media_file, media_item, media_library, photo_asset,
    photo_folder, role_permission, scan_task, tag, tag_resource, user_library_permission,
    video_asset, video_collection, video_collection_member, video_playback_state,
    webdav_connection,
};

pub async fn connect() -> Result<DatabaseConnection, DbErr> {
    let database_url = match env::var("DATABASE_URL") {
        Ok(value) => value,
        Err(_) => default_database_url()?,
    };
    let db = Database::connect(database_url).await?;

    configure_sqlite(&db).await?;
    reset_legacy_schema_if_needed(&db).await?;
    create_tables(&db).await?;
    ensure_avatar_directories()?;
    backfill_app_tasks(&db).await?;

    Ok(db)
}

fn default_database_url() -> Result<String, DbErr> {
    let data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data");

    fs::create_dir_all(&data_dir).map_err(|err| DbErr::Custom(err.to_string()))?;

    let db_path = data_dir.join("app.db");
    let normalized_path = db_path.to_string_lossy().replace('\\', "/");

    Ok(format!("sqlite://{normalized_path}?mode=rwc"))
}

async fn create_tables(db: &DatabaseConnection) -> Result<(), DbErr> {
    create_table(db, app_setting::Entity).await?;
    create_table(db, app_user::Entity).await?;
    create_table(db, auth_session::Entity).await?;
    create_table(db, author::Entity).await?;
    create_table(db, author_avatar::Entity).await?;
    create_table(db, author_resource::Entity).await?;
    create_table(db, tag::Entity).await?;
    create_table(db, tag_resource::Entity).await?;
    create_table(db, role_permission::Entity).await?;
    create_table(db, user_library_permission::Entity).await?;
    create_table(db, webdav_connection::Entity).await?;
    create_table(db, media_library::Entity).await?;
    create_table(db, scan_task::Entity).await?;
    create_table(db, app_task::Entity).await?;
    create_table(db, media_item::Entity).await?;
    create_table(db, media_file::Entity).await?;
    create_table(db, video_asset::Entity).await?;
    create_table(db, video_collection::Entity).await?;
    create_table(db, video_collection_member::Entity).await?;
    create_table(db, video_playback_state::Entity).await?;
    create_table(db, manga_series::Entity).await?;
    create_table(db, manga_chapter::Entity).await?;
    create_table(db, manga_page::Entity).await?;
    create_table(db, photo_asset::Entity).await?;
    create_table(db, photo_folder::Entity).await?;
    ensure_schema_columns(db).await?;
    backfill_author_avatar_history(db).await?;
    create_indexes(db).await?;
    ensure_default_app_settings(db).await?;
    ensure_initial_super_admin(db).await?;
    ensure_default_role_permissions(db).await?;

    Ok(())
}

async fn backfill_author_avatar_history(db: &DatabaseConnection) -> Result<(), DbErr> {
    for author in author::Entity::find().all(db).await? {
        let Some(file_name) = author.avatar_file_name.clone() else {
            continue;
        };
        let exists = author_avatar::Entity::find()
            .filter(author_avatar::Column::AuthorId.eq(author.id.clone()))
            .filter(author_avatar::Column::FileName.eq(file_name.clone()))
            .one(db)
            .await?
            .is_some();
        if !exists {
            author_avatar::ActiveModel {
                id: Set(uuid::Uuid::new_v4().to_string()),
                author_id: Set(author.id),
                file_name: Set(file_name),
                created_at: Set(author.updated_at),
            }
            .insert(db)
            .await?;
        }
    }
    Ok(())
}

async fn ensure_schema_columns(db: &DatabaseConnection) -> Result<(), DbErr> {
    add_column_if_missing(
        db,
        "app_settings",
        "video_ffmpeg_command",
        "TEXT NOT NULL DEFAULT 'ffmpeg'",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "video_cover_time_percent",
        "INTEGER NOT NULL DEFAULT 20",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "preview_max_dimension",
        "INTEGER NOT NULL DEFAULT 960",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "preview_quality",
        "INTEGER NOT NULL DEFAULT 55",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "media_cache_max_bytes",
        "BIGINT NOT NULL DEFAULT 21474836480",
    )
    .await?;
    add_column_if_missing(db, "app_settings", "media_cache_directory", "TEXT").await?;
    add_column_if_missing(
        db,
        "app_settings",
        "video_probe_enabled",
        "BOOLEAN NOT NULL DEFAULT 1",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "video_probe_command",
        "TEXT NOT NULL DEFAULT 'ffprobe'",
    )
    .await?;
    add_column_if_missing(
        db,
        "app_settings",
        "video_probe_timeout_seconds",
        "INTEGER NOT NULL DEFAULT 30",
    )
    .await?;
    add_column_if_missing(
        db,
        "scan_tasks",
        "processed_files",
        "BIGINT NOT NULL DEFAULT 0",
    )
    .await?;
    add_column_if_missing(
        db,
        "scan_tasks",
        "removed_files",
        "BIGINT NOT NULL DEFAULT 0",
    )
    .await?;
    add_column_if_missing(
        db,
        "media_libraries",
        "previews_enabled",
        "BOOLEAN NOT NULL DEFAULT 1",
    )
    .await?;
    add_column_if_missing(
        db,
        "media_libraries",
        "source_type",
        "TEXT NOT NULL DEFAULT 'local'",
    )
    .await?;
    add_column_if_missing(db, "media_libraries", "webdav_connection_id", "TEXT").await?;
    add_column_if_missing(db, "media_libraries", "scan_extensions", "TEXT").await?;
    add_column_if_missing(
        db,
        "media_libraries",
        "collections_enabled",
        "BOOLEAN NOT NULL DEFAULT 0",
    )
    .await?;
    add_column_if_missing(db, "media_libraries", "collection_type", "TEXT").await?;
    add_column_if_missing(db, "media_files", "source_locator", "TEXT").await?;
    add_column_if_missing(db, "media_files", "etag", "TEXT").await?;
    add_column_if_missing(db, "video_assets", "poster_rel_path", "TEXT").await?;
    add_column_if_missing(db, "video_assets", "poster_file_size", "BIGINT").await?;
    add_column_if_missing(db, "video_assets", "poster_generated_at", "TEXT").await?;
    add_column_if_missing(db, "video_assets", "poster_error", "TEXT").await?;
    add_column_if_missing(
        db,
        "photo_assets",
        "folder_path",
        "TEXT NOT NULL DEFAULT ''",
    )
    .await?;
    add_column_if_missing(db, "photo_assets", "preview_rel_path", "TEXT").await?;
    add_column_if_missing(db, "photo_assets", "preview_file_size", "BIGINT").await?;
    add_column_if_missing(db, "photo_assets", "preview_generated_at", "TEXT").await?;
    add_column_if_missing(db, "media_items", "deleted_at", "TEXT").await?;
    add_column_if_missing(db, "media_items", "source_missing_at", "TEXT").await?;
    add_column_if_missing(db, "app_users", "display_name", "TEXT").await?;
    add_column_if_missing(db, "app_users", "avatar_url", "TEXT").await?;
    add_column_if_missing(db, "authors", "avatar_file_name", "TEXT").await?;
    add_column_if_missing(db, "tags", "avatar_url", "TEXT").await?;
    add_column_if_missing(db, "tags", "background_url", "TEXT").await?;

    Ok(())
}

fn ensure_avatar_directories() -> Result<(), DbErr> {
    let avatars = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("avatars");
    fs::create_dir_all(avatars.join("authors")).map_err(|err| DbErr::Custom(err.to_string()))?;
    fs::create_dir_all(avatars.join("users")).map_err(|err| DbErr::Custom(err.to_string()))?;
    Ok(())
}

async fn ensure_default_app_settings(db: &DatabaseConnection) -> Result<(), DbErr> {
    if app_setting::Entity::find_by_id("global")
        .one(db)
        .await?
        .is_some()
    {
        return Ok(());
    }

    let now = chrono::Utc::now();
    app_setting::ActiveModel {
        id: Set("global".to_owned()),
        preview_max_dimension: Set(960),
        preview_quality: Set(55),
        media_cache_max_bytes: Set(20 * 1024 * 1024 * 1024),
        media_cache_directory: Set(None),
        video_probe_enabled: Set(true),
        video_probe_command: Set("ffprobe".to_owned()),
        video_probe_timeout_seconds: Set(30),
        video_ffmpeg_command: Set("ffmpeg".to_owned()),
        video_cover_time_percent: Set(20),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;

    Ok(())
}

async fn ensure_initial_super_admin(db: &DatabaseConnection) -> Result<(), DbErr> {
    if app_user::Entity::find().count(db).await? > 0 {
        return Ok(());
    }

    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|err| DbErr::Custom(err.to_string()))?;
    let password_hash = Argon2::default()
        .hash_password(b"Mengnex@2026", &salt)
        .map_err(|err| DbErr::Custom(err.to_string()))?
        .to_string();
    let now = chrono::Utc::now();
    app_user::ActiveModel {
        id: Set(uuid::Uuid::new_v4().to_string()),
        username: Set("superadmin".to_owned()),
        display_name: Set(Some("Super Administrator".to_owned())),
        avatar_url: Set(None),
        password_hash: Set(password_hash),
        role: Set("owner".to_owned()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;

    Ok(())
}

async fn ensure_default_role_permissions(db: &DatabaseConnection) -> Result<(), DbErr> {
    if role_permission::Entity::find().count(db).await? > 0 {
        return Ok(());
    }

    let defaults: [(&str, &[&str]); 4] = [
        (
            "owner",
            &["media.read", "media.write", "system.manage", "role.manage"],
        ),
        ("admin", &["media.read", "media.write", "system.manage"]),
        ("editor", &["media.read", "media.write"]),
        ("viewer", &["media.read"]),
    ];
    let now = chrono::Utc::now();
    for (role, permissions) in defaults {
        for permission in permissions {
            role_permission::ActiveModel {
                id: Set(uuid::Uuid::new_v4().to_string()),
                role: Set(role.to_owned()),
                permission: Set((*permission).to_owned()),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(db)
            .await?;
        }
    }
    Ok(())
}

async fn create_indexes(db: &DatabaseConnection) -> Result<(), DbErr> {
    for statement in [
        "CREATE INDEX IF NOT EXISTS idx_scan_tasks_library_id ON scan_tasks(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_scan_tasks_updated_at ON scan_tasks(updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_app_tasks_library_id ON app_tasks(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_tasks_kind_status ON app_tasks(kind, status)",
        "CREATE INDEX IF NOT EXISTS idx_app_tasks_updated_at ON app_tasks(updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_media_files_library_id ON media_files(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_media_files_full_path ON media_files(full_path)",
        "CREATE INDEX IF NOT EXISTS idx_media_files_library_source_locator ON media_files(library_id, source_locator)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_video_assets_file_id ON video_assets(file_id)",
        "CREATE INDEX IF NOT EXISTS idx_video_assets_library_id ON video_assets(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_video_assets_library_created_at ON video_assets(library_id, created_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_video_collections_library_path ON video_collections(library_id, source_path)",
        "CREATE INDEX IF NOT EXISTS idx_video_collection_members_collection ON video_collection_members(collection_id, sort_order)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_video_collection_members_asset ON video_collection_members(video_asset_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_video_playback_user_asset ON video_playback_states(user_id, video_asset_id)",
        "CREATE INDEX IF NOT EXISTS idx_video_playback_user_recent ON video_playback_states(user_id, last_played_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_library_id ON photo_assets(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_library_batch_time ON photo_assets(library_id, batch_time DESC)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_file_id ON photo_assets(file_id)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_library_folder_path ON photo_assets(library_id, folder_path, batch_time DESC)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_batch_time ON photo_assets(batch_time DESC)",
        "CREATE INDEX IF NOT EXISTS idx_media_items_library_id ON media_items(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_media_items_deleted_at ON media_items(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_media_items_source_missing_at ON media_items(source_missing_at)",
        "CREATE INDEX IF NOT EXISTS idx_manga_series_library ON manga_series(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_manga_chapters_series ON manga_chapters(series_id, sort_order)",
        "CREATE INDEX IF NOT EXISTS idx_manga_pages_chapter ON manga_pages(chapter_id, sort_order)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authors_normalized_name ON authors(normalized_name)",
        "CREATE INDEX IF NOT EXISTS idx_author_avatars_author ON author_avatars(author_id, created_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_author_resources_unique ON author_resources(author_id, resource_type, resource_id)",
        "CREATE INDEX IF NOT EXISTS idx_author_resources_resource ON author_resources(resource_type, resource_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_resources_unique ON tag_resources(tag_id, resource_type, resource_id)",
        "CREATE INDEX IF NOT EXISTS idx_tag_resources_resource ON tag_resources(resource_type, resource_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)",
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token)",
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_media_libraries_webdav_connection_id ON media_libraries(webdav_connection_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_folders_library_path ON photo_folders(library_id, path)",
        "CREATE INDEX IF NOT EXISTS idx_photo_folders_library_parent ON photo_folders(library_id, parent_path)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_role_permission ON role_permissions(role, permission)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_library_permissions_user_library ON user_library_permissions(user_id, library_id)",
    ] {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            statement.to_owned(),
        ))
        .await?;
    }

    Ok(())
}

async fn reset_legacy_schema_if_needed(db: &DatabaseConnection) -> Result<(), DbErr> {
    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(media_libraries)",
        ))
        .await?;

    if rows.is_empty() {
        return Ok(());
    }

    let mut legacy_uuid_schema = false;

    for row in rows {
        let name: String = row.try_get("", "name")?;
        let column_type: String = row.try_get("", "type")?;

        let normalized_type = column_type.to_uppercase();
        let is_text_affinity = normalized_type.contains("TEXT")
            || normalized_type.contains("CHAR")
            || normalized_type.contains("CLOB");

        if name == "id" && !is_text_affinity {
            legacy_uuid_schema = true;
            break;
        }
    }

    if !legacy_uuid_schema {
        return Ok(());
    }

    println!(
        "Detected legacy SQLite schema with binary UUID columns. Rebuilding development tables."
    );

    for table in [
        "photo_assets",
        "media_files",
        "media_items",
        "scan_tasks",
        "media_libraries",
    ] {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            format!("DROP TABLE IF EXISTS {table}"),
        ))
        .await?;
    }

    Ok(())
}

async fn create_table<E>(db: &DatabaseConnection, entity: E) -> Result<(), DbErr>
where
    E: sea_orm::EntityTrait,
{
    let schema = Schema::new(DbBackend::Sqlite);
    let statement = schema
        .create_table_from_entity(entity)
        .if_not_exists()
        .to_owned();

    db.execute(db.get_database_backend().build(&statement))
        .await?;

    Ok(())
}

async fn add_column_if_missing(
    db: &DatabaseConnection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), DbErr> {
    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info({table})"),
        ))
        .await?;

    let exists = rows.into_iter().any(|row| {
        row.try_get::<String>("", "name")
            .map(|name| name == column)
            .unwrap_or(false)
    });

    if exists {
        return Ok(());
    }

    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
    ))
    .await?;

    Ok(())
}

async fn configure_sqlite(db: &DatabaseConnection) -> Result<(), DbErr> {
    for statement in [
        "PRAGMA journal_mode = WAL",
        "PRAGMA synchronous = NORMAL",
        "PRAGMA busy_timeout = 5000",
        "PRAGMA foreign_keys = ON",
    ] {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            statement.to_owned(),
        ))
        .await?;
    }

    Ok(())
}

async fn backfill_app_tasks(db: &DatabaseConnection) -> Result<(), DbErr> {
    let existing_task_ids = app_task::Entity::find()
        .all(db)
        .await?
        .into_iter()
        .map(|task| task.id)
        .collect::<HashSet<_>>();

    for scan in scan_task::Entity::find().all(db).await? {
        if existing_task_ids.contains(&scan.id) {
            continue;
        }

        let progress_percent = if scan.discovered_files <= 0 {
            100
        } else {
            ((scan.processed_files as f64 / scan.discovered_files as f64) * 100.0)
                .round()
                .clamp(0.0, 100.0) as i32
        };
        let detail = format!(
            "已发现 {}，已新增 {}，已更新 {}，已移除 {}",
            scan.discovered_files, scan.inserted_items, scan.updated_files, scan.removed_files
        );

        app_task::ActiveModel {
            id: Set(scan.id),
            kind: Set("scan_library".to_owned()),
            title: Set("扫描媒体库".to_owned()),
            library_id: Set(Some(scan.library_id)),
            status: Set(scan.status),
            progress_percent: Set(progress_percent),
            processed_items: Set(scan.processed_files),
            total_items: Set(scan.discovered_files),
            detail: Set(Some(detail)),
            error_message: Set(scan.error_message),
            metadata_json: Set(None),
            created_at: Set(scan.created_at),
            updated_at: Set(scan.updated_at),
            finished_at: Set(scan.finished_at),
        }
        .insert(db)
        .await?;
    }

    Ok(())
}
