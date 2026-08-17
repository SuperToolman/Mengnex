use std::collections::HashMap;

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbBackend, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Set, Statement, Value, sea_query::Expr,
};
use serde::Deserialize;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        author_resource, media_file, media_item, media_library, video_asset, video_collection,
        video_collection_member, video_playback_state,
    },
    modules::{
        auth::service::CurrentUser,
        videos::{
            dto::{
                UpdateVideoPlaybackRequest, VideoAssetResponse, VideoCatalogResponse,
                VideoCollectionResponse, VideoCoverJobResponse, VideoDetailResponse,
                VideoPlaybackResponse,
            },
            service,
        },
    },
};
use tokio_util::io::ReaderStream;

#[derive(Debug, Deserialize)]
pub struct ListVideosQuery {
    pub library_id: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct VideoCatalogQuery {
    pub library_id: Option<String>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub watched: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, FromQueryResult)]
struct CatalogCount {
    total: i64,
}

#[utoipa::path(delete, path = "/api/videos/covers/{library_id}", params(("library_id" = String, Path)), responses((status = 200, body = VideoCoverJobResponse)), tag = "videos")]
pub async fn delete_covers(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<VideoCoverJobResponse>, ApiError> {
    if crate::modules::tasks::service::find_running_library_background_task(&state.db, &library_id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(
            "video cover generation is running for this library".to_owned(),
        ));
    }
    let summary = service::delete_library_covers(&state.db, &library_id).await?;
    Ok(Json(VideoCoverJobResponse {
        library_id,
        processed_assets: summary.processed_assets,
        generated_covers: summary.generated_covers,
        skipped_assets: summary.skipped_assets,
        failed_assets: summary.failed_assets,
        deleted_covers: summary.deleted_covers,
        reclaimed_bytes: summary.reclaimed_bytes,
    }))
}

#[utoipa::path(get, path = "/api/videos/{id}/poster", params(("id" = String, Path)), responses((status = 200, description = "Generated video poster"), (status = 404)), tag = "videos")]
pub async fn get_poster(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let asset = video_asset::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("video asset"))?;
    if !current.can_access_library(&asset.library_id) {
        return Err(ApiError::NotFound("video asset"));
    }
    let path = service::resolve_cover_path(&asset).ok_or(ApiError::NotFound("video poster"))?;
    let file = tokio::fs::File::open(path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ApiError::NotFound("video poster")
        } else {
            ApiError::Io(error)
        }
    })?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "private, max-age=604800, immutable"),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

fn apply_playback(video: &mut VideoAssetResponse, state: Option<&video_playback_state::Model>) {
    if let Some(state) = state {
        video.playback_position_seconds = state.position_seconds;
        video.playback_completed = state.completed;
    }
}

#[utoipa::path(
    get,
    path = "/api/videos/catalog",
    params(
        ("library_id" = Option<String>, Query),
        ("search" = Option<String>, Query),
        ("sort" = Option<String>, Query),
        ("order" = Option<String>, Query),
        ("watched" = Option<String>, Query),
        ("limit" = Option<u64>, Query),
        ("offset" = Option<u64>, Query)
    ),
    responses((status = 200, body = VideoCatalogResponse)),
    tag = "videos"
)]
pub async fn list_video_catalog(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<VideoCatalogQuery>,
) -> Result<Json<VideoCatalogResponse>, ApiError> {
    let video_library_ids = media_library::Entity::find()
        .filter(media_library::Column::MediaType.is_in(["video", "mixed_video"]))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|library| library.id)
        .filter(|library_id| current.can_access_library(library_id))
        .collect::<Vec<_>>();
    if video_library_ids.is_empty() {
        return Ok(Json(VideoCatalogResponse {
            items: Vec::new(),
            total: 0,
            limit: query.limit.unwrap_or(48).clamp(1, 100),
            offset: query.offset.unwrap_or(0),
        }));
    }

    let search = query
        .search
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let descending = query.order.as_deref() != Some("asc");
    let sort_column = match query.sort.as_deref() {
        Some("title") => "va.title",
        Some("duration") => "va.duration_seconds",
        Some("updated") => "va.updated_at",
        _ => "va.created_at",
    };
    let sort_order = if descending { "DESC" } else { "ASC" };
    let limit = query.limit.unwrap_or(48).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);

    let mut conditions = vec![
        "mi.deleted_at IS NULL".to_owned(),
        "mi.source_missing_at IS NULL".to_owned(),
        "(vcm.video_asset_id IS NULL OR vc.default_video_asset_id = va.id)".to_owned(),
        format!(
            "va.library_id IN ({})",
            vec!["?"; video_library_ids.len()].join(", ")
        ),
    ];
    let mut values = vec![Value::from(current.id.clone())];
    values.extend(video_library_ids.into_iter().map(Value::from));
    if let Some(library_id) = query.library_id.filter(|value| !value.is_empty()) {
        conditions.push("va.library_id = ?".to_owned());
        values.push(Value::from(library_id));
    }
    if let Some(search) = search {
        conditions
            .push("(LOWER(va.title) LIKE LOWER(?) OR LOWER(vc.title) LIKE LOWER(?))".to_owned());
        let pattern = format!("%{search}%");
        values.push(Value::from(pattern.clone()));
        values.push(Value::from(pattern));
    }
    match query.watched.as_deref() {
        Some("completed") => conditions.push("COALESCE(vps.completed, 0) = 1".to_owned()),
        Some("in_progress") => conditions.push(
            "COALESCE(vps.completed, 0) = 0 AND COALESCE(vps.position_seconds, 0) > 0".to_owned(),
        ),
        Some("unwatched") => conditions.push(
            "COALESCE(vps.completed, 0) = 0 AND COALESCE(vps.position_seconds, 0) <= 0".to_owned(),
        ),
        _ => {}
    }
    let from_sql = format!(
        " FROM video_assets va
          JOIN media_items mi ON mi.id = va.item_id
          LEFT JOIN video_collection_members vcm ON vcm.video_asset_id = va.id
          LEFT JOIN video_collections vc ON vc.id = vcm.collection_id
          LEFT JOIN video_playback_states vps ON vps.video_asset_id = va.id AND vps.user_id = ?
          WHERE {}",
        conditions.join(" AND ")
    );
    let total = CatalogCount::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        format!("SELECT COUNT(*) AS total{from_sql}"),
        values.clone(),
    ))
    .one(&state.db)
    .await?
    .map_or(0, |row| row.total.max(0) as u64);

    let mut page_values = values;
    page_values.push(Value::from(limit as i64));
    page_values.push(Value::from(offset as i64));
    let assets = video_asset::Entity::find()
        .from_raw_sql(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "SELECT va.*{from_sql} ORDER BY {sort_column} {sort_order}, va.id {sort_order} LIMIT ? OFFSET ?"
            ),
            page_values,
        ))
        .all(&state.db)
        .await?;
    let asset_ids = assets
        .iter()
        .map(|asset| asset.id.clone())
        .collect::<Vec<_>>();
    let states = if asset_ids.is_empty() {
        HashMap::new()
    } else {
        video_playback_state::Entity::find()
            .filter(video_playback_state::Column::UserId.eq(&current.id))
            .filter(video_playback_state::Column::VideoAssetId.is_in(asset_ids.clone()))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|state| (state.video_asset_id.clone(), state))
            .collect::<HashMap<_, _>>()
    };
    let collection_members = video_collection_member::Entity::find()
        .filter(video_collection_member::Column::VideoAssetId.is_in(asset_ids))
        .all(&state.db)
        .await?;
    let collection_ids = collection_members
        .iter()
        .map(|member| member.collection_id.clone())
        .collect::<Vec<_>>();
    let collections = video_collection::Entity::find()
        .filter(video_collection::Column::Id.is_in(collection_ids.clone()))
        .all(&state.db)
        .await?;
    let collection_by_id = collections
        .iter()
        .map(|collection| (collection.id.clone(), collection))
        .collect::<HashMap<_, _>>();
    let member_collection = collection_members
        .iter()
        .filter_map(|member| {
            collection_by_id
                .get(&member.collection_id)
                .map(|collection| (member.video_asset_id.clone(), *collection))
        })
        .collect::<HashMap<_, _>>();
    let count_members = video_collection_member::Entity::find()
        .filter(video_collection_member::Column::CollectionId.is_in(collection_ids))
        .all(&state.db)
        .await?;
    let member_counts = count_members
        .iter()
        .fold(HashMap::new(), |mut counts, member| {
            *counts.entry(member.collection_id.clone()).or_insert(0_u64) += 1;
            counts
        });
    let items = assets
        .into_iter()
        .map(|asset| {
            let state = states.get(&asset.id);
            let collection = member_collection.get(&asset.id);
            let mut response = VideoAssetResponse::from(asset);
            apply_playback(&mut response, state);
            if let Some(collection) = collection {
                response.title = collection.title.clone();
                response.collection_id = Some(collection.id.clone());
                response.collection_title = Some(collection.title.clone());
                response.collection_type = Some(collection.collection_type.clone());
                response.collection_member_count = member_counts.get(&collection.id).copied();
            }
            response
        })
        .collect();
    Ok(Json(VideoCatalogResponse {
        items,
        total,
        limit,
        offset,
    }))
}

#[utoipa::path(get, path = "/api/videos/{id}", params(("id" = String, Path)), responses((status = 200, body = VideoDetailResponse), (status = 404)), tag = "videos")]
pub async fn get_video(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<VideoDetailResponse>, ApiError> {
    let asset = video_asset::Entity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("video asset"))?;
    if !current.can_access_library(&asset.library_id) {
        return Err(ApiError::NotFound("video asset"));
    }
    let library = media_library::Entity::find_by_id(&asset.library_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    if library.media_type != "video" {
        return Err(ApiError::NotFound("video asset"));
    }
    let file = media_file::Entity::find_by_id(&asset.file_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media file"))?;
    let author_id = author_resource::Entity::find()
        .filter(author_resource::Column::ResourceType.eq("video_asset"))
        .filter(author_resource::Column::ResourceId.eq(&asset.id))
        .one(&state.db)
        .await?
        .map(|resource| resource.author_id);
    let item = media_item::Entity::find_by_id(&asset.item_id)
        .one(&state.db)
        .await?
        .filter(|item| item.deleted_at.is_none())
        .ok_or(ApiError::NotFound("video asset"))?;
    let playback = video_playback_state::Entity::find()
        .filter(video_playback_state::Column::UserId.eq(&current.id))
        .filter(video_playback_state::Column::VideoAssetId.eq(&id))
        .one(&state.db)
        .await?;
    let active_sibling_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::LibraryId.eq(&asset.library_id))
        .filter(media_item::Column::DeletedAt.is_null())
        .filter(media_item::Column::SourceMissingAt.is_null())
        .into_query();
    let mut siblings = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(&asset.library_id))
        .filter(Expr::col(video_asset::Column::ItemId).in_subquery(active_sibling_items))
        .order_by_desc(video_asset::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let sibling_memberships = video_collection_member::Entity::find()
        .all(&state.db)
        .await?;
    let sibling_collections = video_collection::Entity::find()
        .filter(video_collection::Column::LibraryId.eq(&asset.library_id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|collection| (collection.id, collection.default_video_asset_id))
        .collect::<HashMap<_, _>>();
    let hidden_member_ids = sibling_memberships
        .into_iter()
        .filter_map(|membership| {
            sibling_collections
                .get(&membership.collection_id)
                .filter(|default_id| **default_id != membership.video_asset_id)
                .map(|_| membership.video_asset_id)
        })
        .collect::<std::collections::HashSet<_>>();
    siblings.retain(|sibling| !hidden_member_ids.contains(&sibling.id));
    let index = siblings.iter().position(|sibling| sibling.id == id);
    let previous_video_id = index
        .and_then(|value| value.checked_sub(1))
        .map(|value| siblings[value].id.clone());
    let next_video_id = index
        .and_then(|value| siblings.get(value + 1))
        .map(|value| value.id.clone());
    let analysis_error = asset.analysis_error.clone();
    let poster_error = asset.poster_error.clone();
    let membership = video_collection_member::Entity::find()
        .filter(video_collection_member::Column::VideoAssetId.eq(&id))
        .one(&state.db)
        .await?;
    let collection = if let Some(membership) = membership {
        let collection = video_collection::Entity::find_by_id(&membership.collection_id)
            .one(&state.db)
            .await?
            .ok_or(ApiError::NotFound("video collection"))?;
        let memberships = video_collection_member::Entity::find()
            .filter(video_collection_member::Column::CollectionId.eq(&collection.id))
            .order_by_asc(video_collection_member::Column::SortOrder)
            .all(&state.db)
            .await?;
        let member_ids = memberships
            .iter()
            .map(|member| member.video_asset_id.clone())
            .collect::<Vec<_>>();
        let member_assets = video_asset::Entity::find()
            .filter(video_asset::Column::Id.is_in(member_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|asset| (asset.id.clone(), asset))
            .collect::<HashMap<_, _>>();
        let member_states = states_for_assets(
            &state.db,
            &current.id,
            &member_assets.keys().cloned().collect::<Vec<_>>(),
        )
        .await?;
        let mut members = Vec::new();
        for membership in memberships {
            if let Some(asset) = member_assets.get(&membership.video_asset_id) {
                let mut response = VideoAssetResponse::from(asset.clone());
                apply_playback(&mut response, member_states.get(&asset.id));
                response.collection_id = Some(collection.id.clone());
                response.collection_title = Some(collection.title.clone());
                response.collection_type = Some(collection.collection_type.clone());
                members.push(response);
            }
        }
        Some(VideoCollectionResponse {
            id: collection.id,
            title: collection.title,
            collection_type: collection.collection_type,
            default_video_asset_id: collection.default_video_asset_id,
            members,
        })
    } else {
        None
    };
    let mut video = VideoAssetResponse::from(asset);
    apply_playback(&mut video, playback.as_ref());
    Ok(Json(VideoDetailResponse {
        video,
        library_name: library.name,
        file_name: file.file_name,
        file_size: file.file_size,
        source_path: file.source_locator.unwrap_or(file.full_path),
        author_id,
        source_missing: item.source_missing_at.is_some(),
        analysis_error,
        poster_error,
        previous_video_id,
        next_video_id,
        collection,
    }))
}

async fn states_for_assets(
    db: &sea_orm::DatabaseConnection,
    user_id: &str,
    asset_ids: &[String],
) -> Result<HashMap<String, video_playback_state::Model>, ApiError> {
    Ok(video_playback_state::Entity::find()
        .filter(video_playback_state::Column::UserId.eq(user_id))
        .filter(video_playback_state::Column::VideoAssetId.is_in(asset_ids.to_vec()))
        .all(db)
        .await?
        .into_iter()
        .map(|state| (state.video_asset_id.clone(), state))
        .collect())
}

#[utoipa::path(put, path = "/api/videos/{id}/playback", params(("id" = String, Path)), request_body = UpdateVideoPlaybackRequest, responses((status = 200, body = VideoPlaybackResponse)), tag = "videos")]
pub async fn update_playback(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateVideoPlaybackRequest>,
) -> Result<Json<VideoPlaybackResponse>, ApiError> {
    if !payload.position_seconds.is_finite()
        || payload.position_seconds < 0.0
        || payload
            .duration_seconds
            .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err(ApiError::BadRequest(
            "invalid playback position or duration".to_owned(),
        ));
    }
    let asset = video_asset::Entity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("video asset"))?;
    if !current.can_access_library(&asset.library_id) {
        return Err(ApiError::NotFound("video asset"));
    }
    let now = Utc::now();
    let position = payload
        .duration_seconds
        .map(|duration| payload.position_seconds.min(duration))
        .unwrap_or(payload.position_seconds);
    let completed = payload.completed.unwrap_or_else(|| {
        payload
            .duration_seconds
            .is_some_and(|duration| duration > 0.0 && position >= duration - 10.0)
    });
    let existing = video_playback_state::Entity::find()
        .filter(video_playback_state::Column::UserId.eq(&current.id))
        .filter(video_playback_state::Column::VideoAssetId.eq(&id))
        .one(&state.db)
        .await?;
    let saved = if let Some(existing) = existing {
        let mut active: video_playback_state::ActiveModel = existing.into();
        active.position_seconds = Set(if completed { 0.0 } else { position });
        active.duration_seconds = Set(payload.duration_seconds);
        active.completed = Set(completed);
        active.last_played_at = Set(now);
        active.updated_at = Set(now);
        active.update(&state.db).await?
    } else {
        video_playback_state::ActiveModel {
            id: Set(uuid::Uuid::new_v4().to_string()),
            user_id: Set(current.id),
            video_asset_id: Set(id),
            position_seconds: Set(if completed { 0.0 } else { position }),
            duration_seconds: Set(payload.duration_seconds),
            completed: Set(completed),
            last_played_at: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&state.db)
        .await?
    };
    Ok(Json(VideoPlaybackResponse {
        video_asset_id: saved.video_asset_id,
        position_seconds: saved.position_seconds,
        duration_seconds: saved.duration_seconds,
        completed: saved.completed,
        last_played_at: saved.last_played_at,
    }))
}

#[utoipa::path(
    get,
    path = "/api/videos",
    params(
        ("library_id" = Option<String>, Query, description = "Restrict results to a media library"),
        ("limit" = Option<u64>, Query, description = "Maximum number of videos"),
        ("offset" = Option<u64>, Query, description = "Number of videos to skip")
    ),
    responses((status = 200, description = "List indexed video assets", body = [VideoAssetResponse])),
    tag = "videos"
)]
pub async fn list_videos(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<ListVideosQuery>,
) -> Result<Json<Vec<VideoAssetResponse>>, ApiError> {
    let mut select = video_asset::Entity::find().order_by_desc(video_asset::Column::CreatedAt);
    let video_library_ids = media_library::Entity::find()
        .filter(media_library::Column::MediaType.eq("video"))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|library| library.id)
        .filter(|library_id| current.can_access_library(library_id))
        .collect::<Vec<_>>();
    select = select.filter(video_asset::Column::LibraryId.is_in(video_library_ids));
    if let Some(library_id) = query.library_id {
        select = select.filter(video_asset::Column::LibraryId.eq(library_id));
    }
    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }
    let videos = select
        .limit(query.limit.unwrap_or(100).clamp(1, 500))
        .all(&state.db)
        .await?
        .into_iter()
        .map(VideoAssetResponse::from)
        .collect();
    Ok(Json(videos))
}
