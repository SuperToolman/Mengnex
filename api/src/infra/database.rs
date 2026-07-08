use std::{collections::HashSet, env, fs, path::PathBuf};

use sea_orm::{ActiveModelTrait, ConnectionTrait, Database, DatabaseConnection, DbBackend, DbErr, EntityTrait, Schema, Statement, Set};

use crate::infra::entities::{
    app_setting, app_task, media_file, media_item, media_library, photo_asset, scan_task,
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
    create_table(db, media_library::Entity).await?;
    create_table(db, scan_task::Entity).await?;
    create_table(db, app_task::Entity).await?;
    create_table(db, media_item::Entity).await?;
    create_table(db, media_file::Entity).await?;
    create_table(db, photo_asset::Entity).await?;
    ensure_schema_columns(db).await?;
    create_indexes(db).await?;

    Ok(())
}

async fn ensure_schema_columns(db: &DatabaseConnection) -> Result<(), DbErr> {
    add_column_if_missing(db, "scan_tasks", "processed_files", "BIGINT NOT NULL DEFAULT 0").await?;
    add_column_if_missing(db, "scan_tasks", "removed_files", "BIGINT NOT NULL DEFAULT 0").await?;
    add_column_if_missing(
        db,
        "media_libraries",
        "thumbnails_enabled",
        "BOOLEAN NOT NULL DEFAULT 1",
    )
    .await?;
    add_column_if_missing(db, "photo_assets", "thumb_rel_path", "TEXT").await?;
    add_column_if_missing(db, "photo_assets", "preview_rel_path", "TEXT").await?;
    add_column_if_missing(db, "photo_assets", "thumb_file_size", "BIGINT").await?;
    add_column_if_missing(db, "photo_assets", "preview_file_size", "BIGINT").await?;
    add_column_if_missing(db, "photo_assets", "thumb_generated_at", "TEXT").await?;
    add_column_if_missing(db, "photo_assets", "preview_generated_at", "TEXT").await?;

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
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_library_id ON photo_assets(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_file_id ON photo_assets(file_id)",
        "CREATE INDEX IF NOT EXISTS idx_photo_assets_batch_time ON photo_assets(batch_time DESC)",
        "CREATE INDEX IF NOT EXISTS idx_media_items_library_id ON media_items(library_id)",
    ] {
        db.execute(Statement::from_string(DbBackend::Sqlite, statement.to_owned()))
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
        db.execute(Statement::from_string(DbBackend::Sqlite, statement.to_owned()))
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
            "discovered {}, inserted {}, updated {}, removed {}",
            scan.discovered_files, scan.inserted_items, scan.updated_files, scan.removed_files
        );

        app_task::ActiveModel {
            id: Set(scan.id),
            kind: Set("scan_library".to_owned()),
            title: Set("Scan library".to_owned()),
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
