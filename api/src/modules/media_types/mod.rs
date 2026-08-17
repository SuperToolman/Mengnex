/// Media-type processors own type-specific indexing decisions while storage
/// sources remain responsible only for enumeration and byte access.
pub trait MediaProcessor: Send + Sync {
    fn media_type(&self) -> &'static str;
    fn accepts(&self, mime_type: Option<&str>, file_name: &str) -> bool;
    fn creates_derived_assets(&self) -> bool {
        false
    }
}

pub struct PhotoProcessor;

pub struct VideoProcessor;
pub struct NovelProcessor;
pub struct MusicProcessor;

impl MediaProcessor for PhotoProcessor {
    fn media_type(&self) -> &'static str {
        "photo"
    }

    fn accepts(&self, mime_type: Option<&str>, file_name: &str) -> bool {
        if mime_type
            .map(|value| value.starts_with("image/"))
            .unwrap_or(false)
        {
            return true;
        }

        file_name
            .rsplit_once('.')
            .map(|(_, extension)| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "jpg" | "jpeg" | "png" | "webp" | "gif"
                )
            })
            .unwrap_or(false)
    }

    fn creates_derived_assets(&self) -> bool {
        true
    }
}

impl MediaProcessor for VideoProcessor {
    fn media_type(&self) -> &'static str {
        "video"
    }

    fn accepts(&self, _mime_type: Option<&str>, file_name: &str) -> bool {
        file_name
            .rsplit_once('.')
            .map(|(_, extension)| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "mp4" | "m4v" | "mkv" | "webm" | "mov" | "avi" | "ts" | "m2ts"
                )
            })
            .unwrap_or(false)
    }

    fn creates_derived_assets(&self) -> bool {
        true
    }
}

impl MediaProcessor for NovelProcessor {
    fn media_type(&self) -> &'static str {
        "novel"
    }

    fn accepts(&self, _mime_type: Option<&str>, file_name: &str) -> bool {
        file_name.rsplit_once('.').is_some_and(|(_, extension)| {
            matches!(extension.to_ascii_lowercase().as_str(), "epub" | "txt")
        })
    }

    fn creates_derived_assets(&self) -> bool {
        true
    }
}

impl MediaProcessor for MusicProcessor {
    fn media_type(&self) -> &'static str {
        "music"
    }
    fn accepts(&self, _mime_type: Option<&str>, file_name: &str) -> bool {
        file_name.rsplit_once('.').is_some_and(|(_, extension)| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mp3" | "flac" | "m4a" | "aac" | "ogg" | "opus" | "wav"
            )
        })
    }
    fn creates_derived_assets(&self) -> bool {
        true
    }
}

static PHOTO_PROCESSOR: PhotoProcessor = PhotoProcessor;
static VIDEO_PROCESSOR: VideoProcessor = VideoProcessor;
static NOVEL_PROCESSOR: NovelProcessor = NovelProcessor;
static MUSIC_PROCESSOR: MusicProcessor = MusicProcessor;

pub fn processor_for(media_type: &str) -> Option<&'static dyn MediaProcessor> {
    // Add video, music, book, comic, and game processors here without
    // changing source enumeration or the common media index.
    let processors: [&dyn MediaProcessor; 4] = [
        &PHOTO_PROCESSOR,
        &VIDEO_PROCESSOR,
        &NOVEL_PROCESSOR,
        &MUSIC_PROCESSOR,
    ];

    if matches!(media_type, "mixed_video" | "movie" | "anime" | "series") {
        return Some(&VIDEO_PROCESSOR);
    }

    processors
        .into_iter()
        .find(|processor| processor.media_type() == media_type)
}

#[cfg(test)]
mod tests {
    use super::processor_for;

    #[test]
    fn photo_processor_accepts_images_and_rejects_non_images() {
        let processor = processor_for("photo").expect("photo processor");
        assert!(processor.accepts(Some("image/jpeg"), "cover.jpg"));
        assert!(processor.accepts(None, "cover.webp"));
        assert!(!processor.accepts(Some("audio/mpeg"), "track.mp3"));
    }

    #[test]
    fn video_processor_accepts_common_video_containers() {
        let processor = processor_for("video").expect("video processor");
        assert!(processor.creates_derived_assets());
        assert!(processor.accepts(Some("video/mp4"), "clip.mp4"));
        assert!(processor.accepts(None, "episode.mkv"));
        assert!(!processor.accepts(Some("image/jpeg"), "cover.jpg"));
        assert!(!processor.accepts(Some("video/webp"), "cover.webp"));
    }

    #[test]
    fn novel_processor_accepts_epub_and_text() {
        let processor = processor_for("novel").expect("novel processor");
        assert!(processor.creates_derived_assets());
        assert!(processor.accepts(None, "book.epub"));
        assert!(processor.accepts(None, "book.txt"));
        assert!(!processor.accepts(None, "book.pdf"));
    }

    #[test]
    fn music_processor_accepts_common_audio_containers() {
        let processor = processor_for("music").expect("music processor");
        assert!(processor.creates_derived_assets());
        assert!(processor.accepts(Some("audio/mpeg"), "track.mp3"));
        assert!(processor.accepts(None, "album.flac"));
        assert!(processor.accepts(None, "voice.opus"));
        assert!(!processor.accepts(None, "cover.jpg"));
    }
}
