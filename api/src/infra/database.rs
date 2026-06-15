use std::{env, fs, path::PathBuf};

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, DbErr, Schema, Statement};

use crate::infra::entities::{media_file, media_item, media_library, photo_asset, scan_task};

pub async fn connect() -> Result<DatabaseConnection, DbErr> {
    let database_url = match env::var("DATABASE_URL") {
        Ok(value) => value,
        Err(_) => default_database_url()?,
    };
    let db = Database::connect(database_url).await?;

    reset_legacy_schema_if_needed(&db).await?;
    create_tables(&db).await?;

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
    create_table(db, media_library::Entity).await?;
    create_table(db, scan_task::Entity).await?;
    create_table(db, media_item::Entity).await?;
    create_table(db, media_file::Entity).await?;
    create_table(db, photo_asset::Entity).await?;

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
