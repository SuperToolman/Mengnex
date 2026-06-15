# Mengnex

Mengnex is a media management project inspired by Emby, Quark, Steam, and local media library tools. The goal is to manage richer media types across multiple clients, including photos, games, manga, anime, movies, series, novels, and music.

Current focus:

- Scan local media library paths.
- Persist media library, scan task, media file, and photo asset records.
- Provide a Web API for Web/PC management clients.
- Render scanned photos in the web gallery.

## Structure

```text
.
|-- api/                  # Rust Axum Web API
|   |-- data/             # SQLite database files, ignored except .gitkeep
|   `-- src/
|       |-- core/         # App router, errors, health, OpenAPI
|       |-- infra/        # SQLite/SeaORM connection and entities
|       `-- modules/      # Feature modules: libraries, media, photos, scanner
|-- web/                  # Next.js + HeroUI web app
|   |-- app/              # App Router pages
|   |-- openapi/          # Exported OpenAPI spec for code generation
|   `-- src/api/          # Generated and wrapped API client
|-- CHANGELOG.md
`-- .gitignore
```

## API

Requirements:

- Rust 1.91+

Run:

```powershell
cd api
cargo run
```

Default address:

- API: `http://127.0.0.1:3001`
- Swagger UI: `http://127.0.0.1:3001/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/openapi.json`

SQLite database files are stored under `api/data/` and are ignored by Git.

## Web

Requirements:

- Node.js 22.18+
- pnpm or npm

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

The web app uses `@hey-api/openapi-ts` to generate a typed client from the API OpenAPI spec.

Regenerate after API changes:

```powershell
cd web
pnpm api:generate
```

The generated files live in `web/src/api/generated`. Application code should import from the wrapper in `web/src/api/client.ts` instead of directly depending on generated internals.

## Current Features

- Media library setup from the web settings page.
- Local path scanning through the API.
- Text UUID storage in SQLite for readable IDs.
- Dedicated `photo_assets` table for photo gallery data.
- Photo gallery loading scanned photos through API file content endpoints.
- HeroUI-based modal workflow for adding and scanning media libraries.

## Notes

- `media_items` is a shared cross-media index, not the final detail table for every media type.
- Type-specific data should live in dedicated tables such as `photo_assets`, and future `game_assets`, `movie_assets`, or manga/anime-specific tables.
- Next Image is configured to allow loading optimized images from the local API during development.
