# Mengnex

快速访问：[根目录英文 README](../../../README.md) | [中文更新日志](CHANGELOG.md) | [英文更新日志](../../../CHANGELOG.md)

Mengnex 是一个媒体管理项目，设计目标参考了 Emby、夸克、Steam 以及本地媒体库工具。项目希望管理更丰富的媒体类型，并支持多端使用，包括照片、游戏、漫画、动漫、电影、剧集、小说、音乐等。

当前阶段的重点：

- 扫描本地媒体库路径。
- 持久化媒体库、扫描任务、媒体文件、照片资源等记录。
- 为 Web 和 PC 管理端提供 Web API。
- 在 Web 图库中展示已扫描的照片。

## 项目结构

```text
.
|-- api/                  # Rust Axum Web API
|   |-- data/             # SQLite 数据库文件，除 .gitkeep 外被 Git 忽略
|   `-- src/
|       |-- core/         # 应用路由、错误处理、健康检查、OpenAPI
|       |-- infra/        # SQLite/SeaORM 连接与实体
|       `-- modules/      # 功能模块：媒体库、媒体、照片、扫描器
|-- web/                  # Next.js + HeroUI Web 应用
|   |-- app/              # App Router 页面
|   |-- openapi/          # 用于代码生成的 OpenAPI 规范
|   `-- src/api/          # 生成的 API 客户端与封装入口
|-- CHANGELOG.md          # 英文更新日志
`-- .gitignore
```

## API

环境要求：

- Rust 1.91+

运行：

```powershell
cd api
cargo run
```

默认地址：

- API：`http://127.0.0.1:3001`
- Swagger UI：`http://127.0.0.1:3001/docs`
- OpenAPI JSON：`http://127.0.0.1:3001/openapi.json`

SQLite 数据库文件存放在 `api/data/` 下，并已被 Git 忽略。

## Web

环境要求：

- Node.js 22.18+
- pnpm 或 npm

运行：

```powershell
cd web
pnpm install
pnpm dev
```

如果 API 没有运行在 `http://127.0.0.1:3001`，可以设置：

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3001"
```

## OpenAPI 客户端

Web 应用使用 `@hey-api/openapi-ts` 根据 API 的 OpenAPI 规范生成类型安全的客户端。

API 变更后重新生成：

```powershell
cd web
pnpm api:generate
```

生成文件位于 `web/src/api/generated`。业务代码应优先从 `web/src/api/client.ts` 这个封装入口导入，而不是直接依赖生成代码内部结构。

## 当前功能

- 在 Web 设置页创建媒体库。
- 通过 API 扫描本地路径。
- SQLite 中使用文本 UUID，便于直接查看数据库内容。
- 使用独立的 `photo_assets` 表保存照片图库数据。
- 照片图库通过 API 文件内容端点加载已扫描照片。
- 使用 HeroUI Modal 完成媒体库添加与扫描流程。

## 说明

- `media_items` 是跨媒体类型的共享索引，不是所有媒体类型的最终详情表。
- 特定媒体类型的数据应放在独立表中，例如当前的 `photo_assets`，以及未来可能增加的 `game_assets`、`movie_assets`、漫画/动漫专用表等。
- 开发环境下，Next Image 已配置为允许从本地 API 加载优化图片。
