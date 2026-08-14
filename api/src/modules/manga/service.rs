use std::{cmp::Ordering, collections::BTreeMap};

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{
        author_resource, manga_chapter, manga_page, manga_series, media_file, media_library,
        tag_resource,
    },
    modules::authors::service::link_author,
    modules::tags::service::link_tag_name,
};

type ChapterFiles = BTreeMap<(String, String), Vec<media_file::Model>>;

pub async fn rebuild_image_manga_index(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<(), ApiError> {
    let mut series = BTreeMap::<(String, String, String), ChapterFiles>::new();
    for file in media_file::Entity::find()
        .filter(media_file::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?
    {
        if !is_image(&file) {
            continue;
        }
        let Some((series_path, title, layout, chapter_path, chapter_title)) =
            classify(&file.full_path, library)
        else {
            continue;
        };
        series
            .entry((series_path, title, layout))
            .or_default()
            .entry((chapter_path, chapter_title))
            .or_default()
            .push(file);
    }

    let txn = db.begin().await?;
    let old_series = manga_series::Entity::find()
        .filter(manga_series::Column::LibraryId.eq(library.id.clone()))
        .all(&txn)
        .await?;
    let series_ids = old_series
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    author_resource::Entity::delete_many()
        .filter(author_resource::Column::ResourceType.eq("manga_series"))
        .filter(author_resource::Column::ResourceId.is_in(series_ids.clone()))
        .exec(&txn)
        .await?;
    tag_resource::Entity::delete_many()
        .filter(tag_resource::Column::ResourceType.eq("manga_series"))
        .filter(tag_resource::Column::ResourceId.is_in(series_ids.clone()))
        .exec(&txn)
        .await?;
    let chapter_ids = manga_chapter::Entity::find()
        .filter(manga_chapter::Column::SeriesId.is_in(series_ids.clone()))
        .all(&txn)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    manga_page::Entity::delete_many()
        .filter(manga_page::Column::ChapterId.is_in(chapter_ids))
        .exec(&txn)
        .await?;
    manga_chapter::Entity::delete_many()
        .filter(manga_chapter::Column::SeriesId.is_in(series_ids))
        .exec(&txn)
        .await?;
    manga_series::Entity::delete_many()
        .filter(manga_series::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;

    let now = Utc::now();
    for ((source_path, title, layout), chapters) in series {
        let series_id = Uuid::new_v4().to_string();
        let page_count = chapters.values().map(|files| files.len() as i64).sum();
        let cover_file_id = chapters
            .values()
            .next()
            .and_then(|files| files.first())
            .map(|file| file.id.clone());
        manga_series::ActiveModel {
            id: Set(series_id.clone()),
            library_id: Set(library.id.clone()),
            title: Set(title.clone()),
            layout: Set(layout.clone()),
            source_path: Set(source_path),
            cover_file_id: Set(cover_file_id),
            chapter_count: Set(chapters.len() as i64),
            page_count: Set(page_count),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
        link_author(&txn, &title, &series_id).await?;
        link_tag_name(
            &txn,
            if layout == "chapter" {
                "连载"
            } else {
                "单行本"
            },
            "manga_series",
            &series_id,
        )
        .await?;
        for tag_name in parenthetical_tags(&title) {
            link_tag_name(&txn, tag_name, "manga_series", &series_id).await?;
        }
        let mut chapter_entries = chapters.into_iter().collect::<Vec<_>>();
        chapter_entries.sort_by(|left, right| natural_compare(&left.0.1, &right.0.1));
        for (chapter_order, ((chapter_path, chapter_title), mut files)) in
            chapter_entries.into_iter().enumerate()
        {
            files.sort_by(|left, right| natural_compare(&left.file_name, &right.file_name));
            let chapter_id = Uuid::new_v4().to_string();
            manga_chapter::ActiveModel {
                id: Set(chapter_id.clone()),
                series_id: Set(series_id.clone()),
                title: Set(chapter_title),
                source_path: Set(chapter_path),
                sort_order: Set(chapter_order as i64),
                cover_file_id: Set(files.first().map(|file| file.id.clone())),
                page_count: Set(files.len() as i64),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&txn)
            .await?;
            for (page_order, file) in files.into_iter().enumerate() {
                manga_page::ActiveModel {
                    id: Set(Uuid::new_v4().to_string()),
                    chapter_id: Set(chapter_id.clone()),
                    file_id: Set(file.id),
                    sort_order: Set(page_order as i64),
                    created_at: Set(now),
                }
                .insert(&txn)
                .await?;
            }
        }
    }
    txn.commit().await?;
    Ok(())
}

fn is_image(file: &media_file::Model) -> bool {
    matches!(
        file.extension
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp"
    )
}

fn classify(
    path: &str,
    library: &media_library::Model,
) -> Option<(String, String, String, String, String)> {
    let normalized = path.replace('\\', "/");
    let root = library.root_path.replace('\\', "/");
    let relative = normalized.strip_prefix(&root)?.trim_matches('/');
    let mut directories = relative.split('/').collect::<Vec<_>>();
    directories.pop()?;
    let parent = (*directories.last()?).to_owned();
    let chapter_path = relative
        .rsplit_once('/')
        .map(|(value, _)| value)
        .unwrap_or_default()
        .to_owned();
    if is_chapter_name(&parent) {
        directories.pop();
        let title = directories
            .last()
            .copied()
            .unwrap_or(&library.name)
            .to_owned();
        Some((
            directories.join("/"),
            title,
            "chapter".to_owned(),
            chapter_path,
            parent,
        ))
    } else {
        Some((
            directories.join("/"),
            parent.clone(),
            "single".to_owned(),
            chapter_path,
            parent,
        ))
    }
}

fn is_chapter_name(value: &str) -> bool {
    let lowercase = value.to_ascii_lowercase();
    (value.contains('\u{7b2c}')
        && (value.contains('\u{7ae0}') || value.contains('\u{8bdd}') || value.contains('\u{8282}')))
        || lowercase.contains("chapter")
        || lowercase.starts_with("ch.")
}

fn parenthetical_tags(value: &str) -> Vec<&str> {
    let mut tags = Vec::new();
    let mut start = None;
    let mut close = '\0';
    let mut square_bracket_depth = 0usize;

    for (index, character) in value.char_indices() {
        if start.is_none() {
            match character {
                '[' | '［' => {
                    square_bracket_depth += 1;
                    continue;
                }
                ']' | '］' if square_bracket_depth > 0 => {
                    square_bracket_depth -= 1;
                    continue;
                }
                _ => {}
            }
        }
        if square_bracket_depth > 0 {
            continue;
        }
        match (start, character) {
            (None, '(') => {
                start = Some(index + character.len_utf8());
                close = ')';
            }
            (None, '（') => {
                start = Some(index + character.len_utf8());
                close = '）';
            }
            (Some(content_start), character) if character == close => {
                let tag = value[content_start..index].trim();
                if !tag.is_empty() && tag.chars().count() <= 64 {
                    tags.push(tag);
                }
                start = None;
                close = '\0';
            }
            _ => {}
        }
    }

    tags
}

fn natural_compare(left: &str, right: &str) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);
    let (left_bytes, right_bytes) = (left.as_bytes(), right.as_bytes());
    while left_index < left_bytes.len() && right_index < right_bytes.len() {
        let left_is_digit = left_bytes[left_index].is_ascii_digit();
        let right_is_digit = right_bytes[right_index].is_ascii_digit();
        if left_is_digit && right_is_digit {
            let left_end = left_index
                + left_bytes[left_index..]
                    .iter()
                    .take_while(|byte| byte.is_ascii_digit())
                    .count();
            let right_end = right_index
                + right_bytes[right_index..]
                    .iter()
                    .take_while(|byte| byte.is_ascii_digit())
                    .count();
            let left_number = left[left_index..left_end]
                .parse::<u64>()
                .unwrap_or(u64::MAX);
            let right_number = right[right_index..right_end]
                .parse::<u64>()
                .unwrap_or(u64::MAX);
            match left_number.cmp(&right_number) {
                Ordering::Equal => {}
                order => return order,
            }
            left_index = left_end;
            right_index = right_end;
            continue;
        }
        let left_char = left[left_index..].chars().next().expect("valid UTF-8");
        let right_char = right[right_index..].chars().next().expect("valid UTF-8");
        match left_char.cmp(&right_char) {
            Ordering::Equal => {}
            order => return order,
        }
        left_index += left_char.len_utf8();
        right_index += right_char.len_utf8();
    }
    left_bytes.len().cmp(&right_bytes.len())
}

#[cfg(test)]
mod tests {
    use super::{natural_compare, parenthetical_tags};
    #[test]
    fn natural_sort_orders_numeric_names() {
        let mut names = ["10.jpg", "2.jpg", "01.jpg", "1.jpg"];
        names.sort_by(|left, right| natural_compare(left, right));
        assert_eq!(names, ["1.jpg", "01.jpg", "2.jpg", "10.jpg"]);
    }

    #[test]
    fn parenthetical_tags_supports_ascii_and_full_width_parentheses() {
        assert_eq!(
            parenthetical_tags("(C106) [ネッシートマト]会场限定本（チェンソーマン）[中国翻译]"),
            vec!["C106", "チェンソーマン"],
        );
    }

    #[test]
    fn ignores_parentheses_nested_inside_square_brackets() {
        assert_eq!(
            parenthetical_tags(
                "(C105) [H.B.A(うさぎなごむ)]悠久の娼エルフ6〈梦幻〉过去编1(オリジナル)"
            ),
            vec!["C105", "オリジナル"],
        );
    }
}
