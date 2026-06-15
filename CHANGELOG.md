# Changelog

## Unreleased

### Added

- Created the Rust `api` service with Axum, SeaORM, SQLite storage under `api/data`, OpenAPI output, Swagger UI, and CORS for the web client.
- Added media management schema foundations: media libraries, scan tasks, shared media items/files, and dedicated photo assets.
- Added filesystem scanning for photo libraries, including database writes and local media file streaming through API endpoints.
- Added settings pages in the web app for preferences and media library management.
- Added `@hey-api/openapi-ts` generation flow and a typed frontend API client.
- Updated the photo gallery page to load scanned photos from the API and display them through the existing gallery/viewer components.

### Changed

- Reworked API IDs to store UUIDs as text strings in SQLite so database inspection does not show binary UUID data.
- Reorganized the API source layout into `core`, `infra`, and feature `modules`.
- Centralized repository ignore rules into the root `.gitignore`.

### Fixed

- Fixed Next Image loading from the local API by allowing local IP image optimization.
- Fixed frontend API response unwrapping for generated hey-api client responses.
- Fixed stale settings route layout by moving settings pages under the `(setting)` route group.
