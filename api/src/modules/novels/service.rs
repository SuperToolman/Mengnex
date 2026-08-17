use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use chrono::Utc;
use quick_xml::{Reader, events::Event};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, Set, TransactionTrait,
};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    core::error::ApiError,
    infra::entities::{media_file, media_library, novel_book, novel_chapter},
    modules::{
        photos::service::PreviewOperationSummary, sources, tasks::service::wait_for_task_permit,
    },
};

const MAX_BOOK_BYTES: i64 = 32 * 1024 * 1024;
const MAX_CHAPTERS: usize = 5_000;

#[derive(Debug)]
struct ParsedChapter {
    title: String,
    href: Option<String>,
    word_count: i64,
}
#[derive(Debug)]
struct ParsedBook {
    title: Option<String>,
    author: Option<String>,
    language: Option<String>,
    description: Option<String>,
    chapters: Vec<ParsedChapter>,
    cover: Option<(String, Vec<u8>)>,
}

pub async fn upsert_novel_book<C: ConnectionTrait>(
    db: &C,
    library: &media_library::Model,
    file: &media_file::Model,
    fallback_title: &str,
) -> Result<(), ApiError> {
    let now = Utc::now();
    if let Some(existing) = novel_book::Entity::find()
        .filter(novel_book::Column::FileId.eq(&file.id))
        .one(db)
        .await?
    {
        let mut active: novel_book::ActiveModel = existing.into();
        active.title = Set(fallback_title.to_owned());
        active.parse_status = Set("pending".to_owned());
        active.parse_error = Set(None);
        active.parsed_at = Set(None);
        active.updated_at = Set(now);
        active.update(db).await?;
        return Ok(());
    }
    novel_book::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        item_id: Set(file.item_id.clone()),
        file_id: Set(file.id.clone()),
        library_id: Set(library.id.clone()),
        title: Set(fallback_title.to_owned()),
        author: Set(None),
        language: Set(None),
        description: Set(None),
        format: Set(file.extension.clone().unwrap_or_else(|| "txt".to_owned())),
        cover_rel_path: Set(None),
        chapter_count: Set(0),
        parse_status: Set("pending".to_owned()),
        parse_error: Set(None),
        parsed_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(())
}

pub async fn generate_library_novel_metadata(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<PreviewOperationSummary, ApiError> {
    let books = novel_book::Entity::find()
        .filter(novel_book::Column::LibraryId.eq(&library.id))
        .all(db)
        .await?;
    let mut summary = PreviewOperationSummary {
        total_operations: books.len() as i64,
        ..Default::default()
    };
    for book in books {
        wait_for_task_permit(db, task_id).await?;
        let result = parse_and_store_book(db, library, &book).await;
        summary.processed_assets += 1;
        match result {
            Ok(generated_cover) => {
                if generated_cover {
                    summary.generated_previews += 1;
                } else {
                    summary.skipped_assets += 1;
                }
            }
            Err(error) => {
                summary.failed_assets += 1;
                summary.last_error = Some(format!("{error:?}"));
                summary.errors.push(format!("{}: {error:?}", book.title));
                mark_parse_failed(db, book.id, format!("{error:?}")).await?;
            }
        }
    }
    Ok(summary)
}

async fn parse_and_store_book(
    db: &DatabaseConnection,
    library: &media_library::Model,
    book: &novel_book::Model,
) -> Result<bool, ApiError> {
    let file = media_file::Entity::find_by_id(&book.file_id)
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("novel file"))?;
    if file.file_size > MAX_BOOK_BYTES {
        return Err(ApiError::BadRequest(
            "novel file is too large to parse".to_owned(),
        ));
    }
    let source = sources::materialize_media_file_for_derivative(db, library, &file).await?;
    let source_path = source.path.clone();
    let format = book.format.clone();
    let parsed = tokio::task::spawn_blocking(move || parse_book(&source_path, &format))
        .await
        .map_err(|error| ApiError::BadRequest(format!("novel parser failed: {error}")))??;
    let cover_rel_path = if let Some((extension, bytes)) = parsed.cover {
        let relative = format!("novels/{}.{}", book.id, extension);
        let target = preview_root().join(&relative);
        tokio::fs::create_dir_all(target.parent().expect("novel cover parent")).await?;
        tokio::fs::write(target, bytes).await?;
        Some(relative)
    } else {
        None
    };
    let now = Utc::now();
    let txn = db.begin().await?;
    novel_chapter::Entity::delete_many()
        .filter(novel_chapter::Column::BookId.eq(&book.id))
        .exec(&txn)
        .await?;
    for (sequence, chapter) in parsed.chapters.into_iter().enumerate() {
        novel_chapter::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            book_id: Set(book.id.clone()),
            sequence: Set(sequence as i64),
            title: Set(chapter.title),
            href: Set(chapter.href),
            word_count: Set(chapter.word_count),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    let mut active: novel_book::ActiveModel = book.clone().into();
    active.title = Set(parsed.title.unwrap_or_else(|| book.title.clone()));
    active.author = Set(parsed.author);
    active.language = Set(parsed.language);
    active.description = Set(parsed.description);
    active.cover_rel_path = Set(cover_rel_path.clone());
    active.chapter_count = Set(novel_chapter::Entity::find()
        .filter(novel_chapter::Column::BookId.eq(&book.id))
        .count(&txn)
        .await? as i64);
    active.parse_status = Set("ready".to_owned());
    active.parse_error = Set(None);
    active.parsed_at = Set(Some(now));
    active.updated_at = Set(now);
    active.update(&txn).await?;
    txn.commit().await?;
    Ok(cover_rel_path.is_some())
}

async fn mark_parse_failed(
    db: &DatabaseConnection,
    book_id: String,
    error: String,
) -> Result<(), ApiError> {
    if let Some(book) = novel_book::Entity::find_by_id(book_id).one(db).await? {
        let mut active: novel_book::ActiveModel = book.into();
        active.parse_status = Set("failed".to_owned());
        active.parse_error = Set(Some(error));
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
    }
    Ok(())
}

pub async fn read_chapter_content(
    db: &DatabaseConnection,
    library: &media_library::Model,
    book: &novel_book::Model,
    chapter: &novel_chapter::Model,
) -> Result<String, ApiError> {
    let file = media_file::Entity::find_by_id(&book.file_id)
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("novel file"))?;
    let source = sources::materialize_media_file_for_derivative(db, library, &file).await?;
    let path = source.path.clone();
    let format = book.format.clone();
    let href = chapter.href.clone();
    tokio::task::spawn_blocking(move || read_book_chapter(&path, &format, href.as_deref()))
        .await
        .map_err(|error| ApiError::BadRequest(format!("novel reader failed: {error}")))?
}

pub fn cover_path(relative_path: &str) -> Option<PathBuf> {
    (!relative_path.contains("..") && relative_path.starts_with("novels/"))
        .then(|| preview_root().join(relative_path))
}

fn preview_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("preview")
}

fn parse_book(path: &Path, format: &str) -> Result<ParsedBook, ApiError> {
    match format {
        "epub" => parse_epub(path),
        "txt" => parse_txt(path),
        _ => Err(ApiError::BadRequest("unsupported novel format".to_owned())),
    }
}

fn parse_txt(path: &Path) -> Result<ParsedBook, ApiError> {
    let content = fs::read_to_string(path)
        .or_else(|_| fs::read(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))?;
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    Ok(ParsedBook {
        title,
        author: None,
        language: None,
        description: None,
        chapters: vec![ParsedChapter {
            title: "全文".to_owned(),
            href: None,
            word_count: word_count(&content),
        }],
        cover: None,
    })
}

fn parse_epub(path: &Path) -> Result<ParsedBook, ApiError> {
    let file = fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::BadRequest(format!("invalid EPUB archive: {error}")))?;
    let container = read_zip_entry(&mut archive, "META-INF/container.xml")?;
    let package_path = xml_attribute(&container, "rootfile", "full-path")
        .ok_or_else(|| ApiError::BadRequest("EPUB package document is missing".to_owned()))?;
    let package = read_zip_entry(&mut archive, &package_path)?;
    let metadata = opf_metadata(&package);
    let manifest = opf_manifest(&package);
    let spine = opf_spine(&package);
    let base = package_path
        .rsplit_once('/')
        .map(|(parent, _)| format!("{parent}/"))
        .unwrap_or_default();
    let cover_id = metadata.get("cover_id").cloned().or_else(|| {
        manifest
            .iter()
            .find_map(|(id, item)| item.properties.contains("cover-image").then(|| id.clone()))
    });
    let cover = cover_id.and_then(|id| manifest.get(&id)).and_then(|item| {
        let entry = join_epub_path(&base, &item.href)?;
        let bytes = read_zip_entry(&mut archive, &entry).ok()?;
        let extension = item
            .href
            .rsplit_once('.')
            .map(|(_, value)| value.to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"))?;
        Some((extension, bytes))
    });
    let chapters = spine
        .into_iter()
        .take(MAX_CHAPTERS)
        .filter_map(|id| {
            let item = manifest.get(&id)?;
            let href = join_epub_path(&base, &item.href)?;
            let content = read_zip_entry(&mut archive, &href).ok()?;
            let text = html_to_text(&String::from_utf8_lossy(&content));
            Some(ParsedChapter {
                title: title_from_href(&item.href),
                href: Some(href),
                word_count: word_count(&text),
            })
        })
        .collect::<Vec<_>>();
    if chapters.is_empty() {
        return Err(ApiError::BadRequest(
            "EPUB has no readable chapters".to_owned(),
        ));
    }
    Ok(ParsedBook {
        title: metadata.get("title").cloned(),
        author: metadata.get("author").cloned(),
        language: metadata.get("language").cloned(),
        description: metadata.get("description").cloned(),
        chapters,
        cover,
    })
}

fn read_book_chapter(path: &Path, format: &str, href: Option<&str>) -> Result<String, ApiError> {
    if format == "txt" {
        return fs::read_to_string(path)
            .or_else(|_| fs::read(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
            .map_err(ApiError::from);
    }
    let file = fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::BadRequest(format!("invalid EPUB archive: {error}")))?;
    let href = href.ok_or_else(|| ApiError::BadRequest("chapter source is missing".to_owned()))?;
    Ok(html_to_text(&String::from_utf8_lossy(&read_zip_entry(
        &mut archive,
        href,
    )?)))
}

fn read_zip_entry(archive: &mut ZipArchive<fs::File>, name: &str) -> Result<Vec<u8>, ApiError> {
    if name.contains("..") || name.starts_with('/') {
        return Err(ApiError::BadRequest("unsafe EPUB entry path".to_owned()));
    }
    let mut entry = archive
        .by_name(name)
        .map_err(|_| ApiError::NotFound("EPUB entry"))?;
    if entry.size() > MAX_BOOK_BYTES as u64 {
        return Err(ApiError::BadRequest("EPUB entry is too large".to_owned()));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[derive(Debug)]
struct ManifestItem {
    href: String,
    properties: String,
}
fn opf_metadata(xml: &[u8]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut current = None;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name =
                    String::from_utf8_lossy(event.local_name().as_ref()).to_ascii_lowercase();
                current = matches!(
                    name.as_str(),
                    "title" | "creator" | "language" | "description"
                )
                .then_some(name.clone());
                if name == "meta"
                    && attribute(&event, "name").as_deref() == Some("cover")
                    && let Some(value) = attribute(&event, "content")
                {
                    values.insert("cover_id".to_owned(), value);
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(key) = current.as_ref()
                    && let Ok(value) = text.unescape()
                {
                    let key = match key.as_str() {
                        "creator" => "author",
                        other => other,
                    };
                    values
                        .entry(key.to_owned())
                        .or_insert_with(|| value.into_owned());
                }
            }
            Ok(Event::End(_)) => current = None,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    values
}
fn opf_manifest(xml: &[u8]) -> HashMap<String, ManifestItem> {
    let mut output = HashMap::new();
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Empty(event)) | Ok(Event::Start(event))
                if event.local_name().as_ref() == b"item" =>
            {
                if let (Some(id), Some(href)) = (attribute(&event, "id"), attribute(&event, "href"))
                {
                    output.insert(
                        id,
                        ManifestItem {
                            href,
                            properties: attribute(&event, "properties").unwrap_or_default(),
                        },
                    );
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    output
}
fn opf_spine(xml: &[u8]) -> Vec<String> {
    let mut output = Vec::new();
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Empty(event)) | Ok(Event::Start(event))
                if event.local_name().as_ref() == b"itemref" =>
            {
                if let Some(id) = attribute(&event, "idref") {
                    output.push(id);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    output
}
fn xml_attribute(xml: &[u8], element: &str, name: &str) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Empty(event)) | Ok(Event::Start(event))
                if event.local_name().as_ref() == element.as_bytes() =>
            {
                return attribute(&event, name);
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buffer.clear();
    }
}
fn attribute(event: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.as_ref() == name.as_bytes())
        .and_then(|attribute| {
            attribute
                .unescape_value()
                .ok()
                .map(|value| value.into_owned())
        })
}
fn join_epub_path(base: &str, href: &str) -> Option<String> {
    let href = href.split('#').next()?;
    (!href.contains("..") && !href.starts_with('/')).then(|| format!("{base}{href}"))
}
fn title_from_href(href: &str) -> String {
    Path::new(href)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名章节")
        .replace(['_', '-'], " ")
}
fn html_to_text(source: &str) -> String {
    let mut reader = Reader::from_str(source);
    reader.config_mut().trim_text(true);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(text)) => {
                if let Ok(value) = text.unescape() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(&value);
                }
            }
            Ok(Event::CData(text)) => {
                if !output.is_empty() {
                    output.push(' ');
                }
                output.push_str(&String::from_utf8_lossy(text.as_ref()));
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn word_count(value: &str) -> i64 {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .count() as i64
}
