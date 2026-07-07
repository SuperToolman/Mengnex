# Mengnex

Mengnex 是一个本地优先的媒体管理项目，设计目标参考了 Emby、夸克、Steam 以及个人本地媒体库工具。项目希望统一管理多种媒体类型，并逐步覆盖桌面端与 Web 端使用场景，包括照片、游戏、漫画、动漫、电影、剧集、小说和音乐等。

## 当前范围

- 在 Web 设置页管理本地媒体库。
- 扫描本地文件系统路径，并将标准化后的媒体记录写入 SQLite。
- 提供完整的照片媒体库流程，包括图库浏览、预览与原图切换。
- 为照片生成并管理 `thumb` / `preview` 缓存，加快列表与查看器加载。
- 用统一任务中心跟踪扫描、缓存生成等长任务。

## 项目结构

```text
.
|-- api/                  # Rust Axum Web API
|   |-- data/             # SQLite 数据库与缩略图/预览图缓存目录
|   `-- src/
|       |-- core/         # 路由、错误处理、健康检查、OpenAPI
|       |-- infra/        # SQLite/SeaORM 连接与实体定义
|       `-- modules/      # 功能模块：libraries、media、photos、preferences、scanner、tasks
|-- web/                  # Next.js + HeroUI Web 客户端
|   |-- app/              # App Router 页面
|   |-- openapi/          # 导出的 OpenAPI 规范
|   `-- src/api/          # 生成后的 API 客户端与手写封装
|-- CHANGELOG.md
`-- .gitignore
```

## 后端

环境要求：

- Rust 1.91+

运行：

```powershell
cd api
cargo run
```

默认地址：

- API: `http://127.0.0.1:3001`
- Swagger UI: `http://127.0.0.1:3001/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/openapi.json`

数据目录：

- `api/data/app.db`：SQLite 应用数据库
- `api/data/thumb/`：缩略图缓存目录
- `api/data/preview/`：预览图缓存目录

仓库中只保留 `thumb` 和 `preview` 的目录占位文件，实际生成的缓存资源不会提交到 Git。

## 前端

环境要求：

- Node.js 22.18+
- pnpm

运行：

```powershell
cd web
pnpm install
pnpm dev
```

如果 API 没有运行在 `http://127.0.0.1:3001`，可设置：

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3001"
```

## OpenAPI 客户端

Web 端使用 `@hey-api/openapi-ts` 根据后端 OpenAPI 规范生成类型安全的客户端。

当 API 发生变更后重新生成：

```powershell
cd web
pnpm api:generate
```

生成文件位于 `web/src/api/generated`。业务代码应优先通过 `web/src/api/client.ts` 访问 API，而不是直接依赖生成代码内部结构。

## 功能概览

### 媒体库

- 从设置页创建照片媒体库。
- 修改媒体库名称、根路径、启用状态，以及“扫描后自动补齐缓存”的行为。
- 按需重新扫描媒体库。
- 在信息弹窗中查看资源数量、缓存占用和生成状态。
- 删除媒体库记录、扫描索引和缓存，但不删除原始媒体文件。

### 照片缓存

- 在 `api/data/thumb` 和 `api/data/preview` 下生成 `thumb` / `preview`。
- 在 `photo_assets` 中记录缓存路径、大小与生成时间。
- 统一使用 WebP 作为当前主缓存格式。
- 前端可选择优先使用缓存图还是直接使用原图。
- 缓存生成与缓存删除可以独立于媒体库创建流程单独执行。

### 任务中心

- 在统一任务中心中查看媒体库扫描任务和缓存生成任务。
- 后端通过 `/api/tasks` 聚合输出任务数据。
- 前端将任务进度集中展示，不再把进度条硬塞进媒体库卡片。

### 界面

- 使用 HeroUI 实现设置页、弹窗和交互流程。
- 使用 Gravity UI 图标构建侧边栏与媒体库操作入口。
- 主内容区独立滚动，顶部头部固定，侧边栏不会被长内容拉伸。

## 说明

- `media_items` 是跨媒体类型的共享索引，不是每种媒体类型的最终详情表。
- 各媒体类型应拥有独立明细表，例如当前的 `photo_assets`，以及未来可能增加的 `game_assets`、`movie_assets`、漫画/动漫专用表等。
- 当前任务系统会聚合“持久化的扫描任务”和“内存中的缓存生成任务”。扫描历史会保留；如果应用重启，进行中的缓存生成任务状态不会持久恢复。
