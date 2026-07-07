# Changelog

## Unreleased

### Added

- Added application preferences storage and API endpoints for choosing whether photos should prefer derivative images or originals.
- Added thumbnail and preview derivative generation for photo libraries, with cache files stored under `api/data/thumb` and `api/data/preview`.
- Added derivative metadata fields to `photo_assets` so cache readiness and cache size can be tracked per asset.
- Added manual cache generation and cache deletion actions to media library management.
- Added a unified task center in the web app and a new `/api/tasks` API endpoint that aggregates scan tasks and cache generation tasks.
- Added media library dialogs for settings, information, and deletion.
- Added WebP derivative output for both `thumb` and `preview`.
- Added placeholder-tracked cache directories with Git ignore rules so generated cache files are not committed.

### Changed

- Changed photo browsing to support derivative-first rendering: gallery items can use `thumb`, while the viewer can prefer `preview`.
- Changed manual cache generation to run as a background task with progress tracking instead of blocking the settings page.
- Changed media library cards to focus on actions and cover previews, moving detailed library information into the info dialog.
- Changed media library management to support re-scan, enable/disable, rename, root-path updates, and cache-generation settings from the UI.
- Changed cache generation to skip already valid assets by default rather than forcing a full rebuild.
- Changed derivative encoding from JPEG to WebP for better size and delivery characteristics.
- Changed the global layout so the top header remains fixed and the main content area scrolls independently without stretching the sidebar.

### Fixed

- Fixed settings-page text regressions by restoring Chinese UI labels.
- Fixed media library card action alignment and hover states for action icons.
- Fixed the media library "more" menu so it closes before opening dialogs such as settings or info.
- Fixed sidebar bottom navigation placement so `任务` and `设置` stay pinned at the bottom.
- Fixed content overflow behavior that previously caused long pages such as the gallery or task list to pull the sidebar and header out of place.
