# Mengnex

Mengnex 是一个本地优先的媒体管理项目，设计目标参考了 Emby、Steam 以及个人本地媒体库工具。项目希望统一管理多种媒体类型，并逐步覆盖桌面端与 Web 端使用场景，包括照片、游戏、漫画、动漫、电影、剧集、小说和音乐等。

## 当前范围

- 在 Web 设置页管理本地媒体库
- 扫描本地文件系统路径，并将标准化后的媒体记录写入 SQLite
- 提供完整的照片媒体库流程，包括图库浏览、预览与原图切换
- 为照片生成并管理 `thumb` / `preview` 缓存，加快列表与查看器加载
- 通过统一任务中心跟踪扫描、缓存生成等后台任务
- 支持后台任务暂停、继续、取消

## 项目结构

```text
.
|-- api/                  # Rust Axum Web API
|   |-- data/             # SQLite 数据库与缩略图/预览图缓存目录
|   `-- src/
|       |-- core/         # 路由、错误处理、健康检查、OpenAPI
|       |-- infra/        # SQLite/SeaORM 连接、实体、基础设施
|       `-- modules/      # libraries、media、photos、preferences、scanner、tasks
|-- web/                  # Next.js Web 客户端
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

- `api/data/app.db`: SQLite 应用数据库
- `api/data/thumb/`: 缩略图缓存目录
- `api/data/preview/`: 预览图缓存目录

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

- 从设置页创建照片媒体库
- 修改媒体库名称、根路径、启用状态，以及“扫描后自动补齐缓存”的行为
- 按需重新扫描媒体库
- 在信息弹窗中查看资源数量、缓存占用和生成状态
- 删除媒体库记录、扫描索引和缓存，但不删除原始媒体文件

### 照片缓存

- 在 `api/data/thumb` 和 `api/data/preview` 下生成 `thumb` / `preview`
- 在 `photo_assets` 中记录缓存路径、大小与生成时间
- 统一使用 WebP 作为当前主缓存格式
- 前端可选择优先使用缓存图还是直接使用原图
- 缓存生成与缓存删除可独立于媒体库创建流程单独执行

### 任务中心

- 在统一任务中心中查看媒体库扫描任务和缓存生成任务
- 后端通过 `/api/tasks` 输出统一任务数据
- 扫描任务与缓存任务都持久化到数据库，应用重启后历史仍可查看
- 支持暂停、继续、取消运行中的后台任务

### 分页与性能

- `/api/photos`、`/api/media/items`、`/api/media/files` 支持 `limit` / `offset`
- 照片页改为分批加载，避免一次拉取全量照片
- 设置页只拉取有限数量的照片封面用于媒体库卡片展示

## 说明

- `media_items` 是跨媒体类型的共享索引，不是每种媒体类型的最终详情表
- 各媒体类型应拥有独立明细表，例如当前的 `photo_assets`，以及未来可能增加的 `game_assets`、`movie_assets` 等
- 当前任务系统已统一为持久化任务模型，扫描和缓存生成都通过后台任务执行
- 扫描中的多表写入与删库时的多表删除已纳入事务，以降低半成功状态风险
