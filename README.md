# Mengnex

Quick access: [Changelog](CHANGELOG.md) | [简体中文](docs/i18n/zh-CN/README.md) | [中文更新日志](docs/i18n/zh-CN/CHANGELOG.md)

Mengnex is a local-first media management project inspired by Emby, Quark, Steam, and personal media library tools. It is designed to manage multiple media types across desktop and web clients, including photos, games, manga, anime, movies, series, novels, and music.

## Current Scope

- Manage local media libraries from the web settings page.
- Scan local filesystem paths and store normalized media records in SQLite.
- Build a dedicated photo library flow with gallery viewing.
- Generate and manage `thumb` / `preview` derivatives for faster photo browsing.
- Track long-running operations such as scans and cache generation in a unified task center.

## Repository Structure

```text
.
|-- api/                  # Rust Axum Web API
|   |-- data/             # SQLite database and derivative cache directories
|   `-- src/
|       |-- core/         # App router, errors, health, OpenAPI
|       |-- infra/        # SQLite/SeaORM connection and entities
|       `-- modules/      # Feature modules: libraries, media, photos, preferences, scanner, tasks
|-- web/                  # Next.js + HeroUI web client
|   |-- app/              # App Router pages
|   |-- openapi/          # Exported OpenAPI spec for client generation
|   `-- src/api/          # Generated and wrapped API client
|-- CHANGELOG.md
`-- .gitignore
```

## Backend

Requirements:

- Rust 1.91+

Run:

```powershell
cd api
cargo run
```

Default addresses:

- API: `http://127.0.0.1:3001`
- Swagger UI: `http://127.0.0.1:3001/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/openapi.json`

Data layout:

- `api/data/app.db`: SQLite application database
- `api/data/thumb/`: generated thumbnail cache
- `api/data/preview/`: generated preview cache

The repository keeps only directory placeholders for `thumb` and `preview`. Generated cache files are ignored by Git.

## Frontend

Requirements:

- Node.js 22.18+
- pnpm

Run:

```powershell
cd web
pnpm install
pnpm dev
```

If the API is not running at `http://127.0.0.1:3001`, set:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3001"
```

## OpenAPI Client

The web app uses `@hey-api/openapi-ts` to generate a typed client from the backend OpenAPI schema.

Regenerate after API changes:

```powershell
cd web
pnpm api:generate
```

Generated files live in `web/src/api/generated`. Application code should import from the wrapper in `web/src/api/client.ts`.

## Features

### Media Libraries

- Create photo media libraries from the settings page.
- Update library name, root path, enabled state, and scan-time cache generation behavior.
- Re-scan libraries on demand.
- View library statistics and cache usage from the info dialog.
- Delete a library without deleting source media files.

### Photo Derivative Cache

- Generate `thumb` and `preview` images under `api/data/thumb` and `api/data/preview`.
- Store derivative metadata on `photo_assets`.
- Use WebP as the primary derivative format.
- Allow the frontend to choose between derivative-first display and original-image display.
- Support manual cache generation and cache deletion independently from library creation.

### Tasks

- Show scan tasks and cache generation tasks in a unified task center.
- Expose task data through `/api/tasks`.
- Surface task progress in the web UI instead of embedding progress directly in media library cards.

### UI

- HeroUI-based settings pages and dialogs.
- Gravity UI icons in sidebar and media library actions.
- Independent content scrolling with a fixed top header and stable sidebar layout.

## Notes

- `media_items` is a shared cross-media index, not the final detail table for every media type.
- Type-specific data should live in dedicated tables such as `photo_assets`, and future `game_assets`, `movie_assets`, or manga/anime-specific tables.
- The task system currently aggregates persisted scan tasks and in-memory cache generation tasks. Scan history survives restarts; active cache task state does not.
