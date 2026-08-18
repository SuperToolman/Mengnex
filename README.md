# Mengnex

Mengnex 是一个本地优先的个人媒体管理项目。它以 Rust API、Next.js Web 客户端和独立 Agent Gateway 组成，目标是统一管理照片、视频、音乐、小说及后续更多媒体类型，并在不让 Agent 直接接触数据库或媒体文件的前提下，为本地媒体库提供可扩展的智能能力。

项目目前处于早期开发阶段。数据结构和内部接口仍可能发生破坏性调整，但运行数据默认不应因正常连接数据库而被重建或清空。

## 当前状态

已可用的主路径：

- 本地目录与 WebDAV 媒体库管理、扫描、缓存和任务追踪。
- 照片浏览、文件夹视图、预览图、大图查看、下载与删除。
- 视频目录、播放、进度、技术信息、封面生成与集合。
- 音乐标签解析、专辑/艺人聚合、播放队列、歌词、收藏、歌单与按需转码。
- EPUB/TXT 小说扫描、章节阅读、封面和阅读进度。
- Owner、Admin、Editor、Viewer 角色及媒体库级访问授权。
- 基于 Cordis 的 Agent Gateway、会话、工具调用、执行策略、审批持久化与插件管理。

当前不将下列能力视为已完成：可靠任务队列、插件安全沙盒、任意第三方插件上传、完整 RAG 知识库、自动化调度、可恢复 Agent 长任务，以及生产级多实例部署。

## 架构概览

```text
Browser (Next.js :7589)
  |  /api 代理，携带 Mengnex 登录 Cookie
  v
Rust API (:7587) -------------------- SQLite / api/data
  |                                      |- 媒体索引、任务、账户
  |                                      |- 预览图、封面、头像
  |                                      `- WebDAV 临时物化文件
  |
  |  仅通过受权限保护的 HTTP API
  v
Agent Gateway (Cordis :7590) -------- agent/data
                                         |- 会话、审批、供应商、插件状态
                                         |- Cordis profile / overlay 配置
                                         `- 本地受信任插件包与 knowledge

API Docs (:7588)
```

### 服务边界

| 服务 | 默认地址 | 职责 |
| --- | --- | --- |
| Rust API | `http://localhost:7587` | 认证、授权、业务规则、SQLite、媒体与任务 API |
| API Docs | `http://localhost:7588/docs` | Swagger UI 与 OpenAPI JSON |
| Web | `http://localhost:7589` | 用户界面、设置、媒体浏览和 Agent 对话 |
| Agent Gateway | `http://localhost:7590` | Cordis 插件生命周期、模型循环、工具与审批 HTTP 网关 |

Rust API 是数据和授权的唯一权威。Agent Gateway 会转发浏览器已有的 Mengnex 会话 Cookie 给 Rust API，以现有用户、角色和媒体库权限执行工具；它不会直接连接 SQLite，也不会直接读取媒体文件或 WebDAV 密钥。

## 目录结构

```text
.
|-- api/                         # Rust / Axum API
|   |-- data/                    # 运行数据（Git 忽略）
|   `-- src/
|       |-- core/                # 路由、错误、OpenAPI、日志
|       |-- infra/               # SeaORM、SQLite、实体与基础设施
|       `-- modules/             # 各领域模块
|-- web/                         # Next.js App Router 客户端
|   |-- app/                     # 页面与路由
|   |-- openapi/                 # 导出的 OpenAPI 规范
|   `-- src/
|       |-- api/                 # 生成 SDK、传输层和兼容门面
|       `-- features/            # 领域请求与 UI 组织
|-- agent/                       # Cordis Agent Gateway
|   |-- plugins/                 # 本地受信任插件包
|   |-- client-plugins/          # 可选的受信任浏览器端插件设置模块
|   |-- knowledge/               # 本地知识库资料根目录
|   |-- data/                    # Agent 持久化状态（Git 忽略）
|   `-- cordis.json              # profile / overlay 组合配置
|-- start.ps1                    # API、Web、Agent 一键启动
|-- CHANGELOG.md
`-- .github/workflows/ci.yml
```

## 快速开始

### 环境要求

- Rust 1.91+
- Node.js 22.18+
- pnpm 10+
- 可选：FFmpeg 和 FFprobe，用于视频封面、视频信息和音乐转码

### 安装依赖

```powershell
cd web
pnpm install

cd ..\agent
pnpm install
```

Rust 依赖会在首次启动 API 时由 Cargo 自动解析。

### 一键启动

在仓库根目录执行：

```powershell
.\start.ps1
```

脚本会依次启动 API、独立 API 文档、Web 和 Agent Gateway，并在 `Ctrl+C` 或任一关键服务退出时清理关联进程。默认端口可以通过以下环境变量覆盖：

```powershell
$env:PORT = "7587"
$env:API_DOCS_PORT = "7588"
$env:WEB_PORT = "7589"
$env:AGENT_PORT = "7590"
.\start.ps1
```

### 分别启动

```powershell
# Rust API
cd api
cargo run

# Web
cd web
pnpm dev --port 7589

# Agent Gateway
cd agent
pnpm dev
```

Web 默认将 `/api/*` 代理到 `http://127.0.0.1:7587`。如 API 地址不同，可设置：

```powershell
$env:API_PROXY_TARGET = "http://127.0.0.1:7587"
$env:NEXT_PUBLIC_API_BASE_URL = ""
```

Agent Gateway 默认使用 `RUST_API_URL=http://127.0.0.1:7587`。可复制并按需修改 [`agent/.env.example`](agent/.env.example)。

首次访问 Web 时创建第一个 Owner 账户。系统不会创建固定默认管理员或默认密码。

## 媒体能力

### 媒体库、来源与权限

- 支持本地目录和 WebDAV 来源；WebDAV 原始文件在读取时按需访问，派生缓存和临时文件由服务端管理。
- Owner、Admin 可访问所有媒体库；Editor、Viewer 只能访问被授予的媒体库。
- 媒体库可启用/停用、重新扫描、管理缓存，并查看封面和统计信息。
- `media_items` 是跨媒体类型的共享索引。照片、视频、音乐和小说保有各自的领域明细和处理逻辑。

### 照片

- `/photo` 提供游标分页的图库、搜索和缩放。
- `/photo/folder` 基于 `source_path` 构建递归文件夹树、面包屑、拼图封面与目录内筛选。
- 使用 WebP `preview` 缓存；查看器先显示预览，再渐进加载原图。
- 支持查看信息、下载原图和真实删除；媒体响应支持 ETag 条件请求。

### 视频

- 提供目录、搜索、排序、观看状态、分页、详情与播放进度。
- 支持 FFprobe 读取技术信息、FFmpeg 抽帧封面和基于目录规则的视频集合。
- 视频浏览不会因鼠标悬停自动加载媒体流；原始视频通过受保护的 Range 请求按需读取。

### 音乐

- 支持 MP3、FLAC、M4A、AAC、OGG、Opus、WAV 的扫描与标签解析。
- 解析标题、专辑、艺人、Album Artist、流派、年份、制作信息、内嵌封面、内嵌歌词和同名 `.lrc`。
- 提供专辑、歌曲、艺人、文件夹、收藏、最近播放、歌单、筛选和分页。
- 全局播放器支持跨页面队列、顺序/随机/单曲循环、音量、进度与播放位置保存。
- 可调用 MusicBrainz 候选匹配；默认不自动覆盖本地标签。
- 可通过 FFmpeg 按需转码本地音频为 AAC 或 Opus（64-320 kbps）。WebDAV 音频转码尚未启用。

音乐表会在首次创建或发现结构不完整时初始化，不会在每次数据库连接时重建。开发期需要主动清空音乐索引和用户音乐状态时，才设置：

```powershell
$env:MENGNEX_RESET_MUSIC_SCHEMA = "1"
```

这只会重建音乐相关数据表，不会删除原始媒体文件。

### 小说

- 支持 EPUB、TXT 扫描、书架、详情、章节、封面与用户阅读进度。
- EPUB 内部 HTML 会在后端转换成纯文本章节，不直接交给浏览器渲染。
- WebDAV EPUB 在解析或阅读期间临时物化，处理后清理；单文件解析上限为 32 MB。

目前不支持 PDF、MOBI、AZW、全文搜索、书签和批注。

## 任务执行器

扫描与媒体信息生成采用“持久化状态 + 进程内执行”的模型：请求先在 SQLite 创建 `queued` 任务，API 内的轮询 worker 领取任务并将其标记为 `running`，然后在全局并发上限内执行。扫描完成后，可按媒体库设置创建独立的媒体信息生成任务。

任务中心支持进度、失败原因、暂停、继续、取消和历史查询。媒体信息生成会按类型分派为照片 Preview、视频技术信息/封面、音乐标签/专辑封面或小说元数据/章节/封面处理。

这是可观测的单进程执行器，不是可靠任务队列：进程重启后，未完成任务会被标记为失败，不会自动恢复。它目前没有任务 lease、heartbeat、跨进程竞争、持久化重试策略或幂等恢复保证，详见“待落地工作”。

SQLite 连接池使用 WAL、NORMAL synchronous、busy timeout、外键检查和有限连接数；扫描和多表删除等关键写入会使用数据库事务。

## Agent 与 Cordis

### 设计原则

Agent 层按 Cordis 的插件化主旨实现：

1. Cordis 内核负责挂载、卸载、依赖关系和服务组合；代理能力存在于插件中。
2. 模型、工具、技能、会话、存储、Agent Loop、知识库、MCP、沙盒、调度和界面均以 capability seam 和插件契约协作。
3. `agent/cordis.json` 的 profile/overlay 可叠加插件启停和配置，支持替换或扩展能力而不修改 Gateway 入口代码。

当前能力边界已经建立，但并非每种能力都已有完整业务实现。会话、存储、模型、工具和循环已可运行；技能、知识库和 MCP 为可安装本地插件包；沙盒和调度当前只有 capability/插件类型边界，尚无可投入使用的实现。

### 当前插件与能力

| 插件/能力 | 当前状态 | 用途 |
| --- | --- | --- |
| `agent-runtime` | 内建且必需 | 工具注册、能力检查、风险分级、审批和执行 |
| `file-storage` | 内建且必需 | 供应商、会话、审批和插件状态的本地 JSON 持久化 |
| `openai-compatible-provider` | 内建，可替换 slot | 调用 OpenAI 兼容 Chat Completions 模型 |
| `agent-loop` | 内建且必需 | 受限的模型/工具调用循环 |
| `core-tools` | 内建且必需 | 通过 Rust API 搜索媒体、读取任务、创建扫描与外部导入 |
| `hello-world` | 本地示例 | 最小可卸载工具插件 |
| `skills` | 本地插件包 | 将配置中的技能指令加入 Agent 上下文 |
| `knowledge-base` | 本地插件包 | 搜索 `agent/knowledge` 内的受信任文档 |
| `mcp-client` | 本地插件包 | 发现已配置的 stdio MCP 服务工具 |

插件声明 `kind`、依赖、提供的服务、权限、配置契约及可选独占 slot。插件替换会按依赖关系暂停受影响依赖项，完成替换后恢复依赖链。浏览器端只能管理已经随本地 Agent 分发并被发现的插件包，不能上传或执行任意 TypeScript/JavaScript。

### 对话、模型与审批

- `/agent` 使用现有 Mengnex 登录身份创建和读取用户隔离会话。
- 会话消息、工具调用和待决审批保存在 `agent/data/`；Gateway 重启不会丢失审批记录。
- 模型供应商通过 Agent 设置中的插件配置管理，支持启停和设置默认供应商。启用的默认供应商必须具备模型名和有效 API Key。
- 执行策略包括 `request_approval`（每次工具执行确认）、`approve_high_risk`（高风险确认）和 `full_access`（可直接执行）。关键风险能力仍保留审批约束。
- 当前工具覆盖媒体搜索、任务列表、创建扫描、外部媒体导入和 Hello World 健康检查。

外部导入工具调用 Rust `POST /api/media/import`。它要求当前用户拥有目标媒体库写入权限，并以 `library_id + source + external_id` 作为幂等键创建或更新外部媒体占位记录。

### 插件配置与信任模型

插件配置描述“插件启动时的参数”，不是直接执行代码。例如：

- `skills` 可配置一组 `id + instruction`，把稳定的领域指令注入对话上下文。
- `knowledge-base` 可配置 `agent/knowledge` 下允许检索的相对路径。
- `mcp-client` 可配置受信任 stdio MCP 服务的命令和参数，并将其公开工具注册给 Agent。

配置页会展示当前持久化值。声明式配置使用表单；复杂插件可提供受信任的浏览器端模块，以自定义交互界面。

本地插件和 MCP 进程目前都属于受信任代码：权限声明用于审阅和策略决策，尚未形成操作系统级沙盒。不要把来源不明的 MCP 命令或插件目录直接加入本地 Agent 分发目录。

## API 与契约

Rust API 使用 Utoipa 输出 OpenAPI；Web 端从 `web/openapi/mengnex.json` 生成类型和 SDK。业务请求优先通过 `web/src/api/transport.ts`、生成 SDK 和按领域收敛的 `web/src/features/` 调用，避免直接散落 `fetch` 造成契约绕过。

同步 OpenAPI 并重新生成 Web SDK：

```powershell
cd web
pnpm api:sync
```

常用 Agent Gateway HTTP 端点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | Gateway 存活与当前执行模式 |
| `GET` | `/v1/tools` | 已注册工具 |
| `GET/POST` | `/v1/sessions` | 列出或新建当前用户会话 |
| `GET` | `/v1/sessions/:id` | 获取当前用户会话 |
| `POST` | `/v1/sessions/:id/messages` | 发送消息并运行 Agent Loop |
| `POST` | `/v1/runs` | 直接调用受控工具 |
| `POST` | `/v1/approvals/:id` | 审批或拒绝待决执行 |
| `GET/PUT` | `/v1/plugins`、`/v1/plugins/:id` | Owner/Admin 管理插件 |
| `GET` | `/v1/plugin-settings` | 获取插件设置贡献 |

## 质量检查

GitHub Actions 会执行：

- `cargo fmt --check`
- `cargo test --locked`
- `cargo clippy --locked --all-targets --all-features -- -D warnings`
- `pnpm api:sync` 与 OpenAPI/生成 SDK 无差异检查
- Web `pnpm lint`、`pnpm build`
- Agent `pnpm build`、`pnpm test`

本地可分别运行：

```powershell
cd api
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets --all-features -- -D warnings

cd ..\web
pnpm api:sync
pnpm lint
pnpm build

cd ..\agent
pnpm build
pnpm test
```

## 待落地工作

下列内容是规划，不代表当前行为。优先级按照稳定性、核心闭环和扩展性排序。

### P0：稳定性与完整闭环

- [ ] 将任务创建、初次领取和可执行状态变更纳入明确事务；为任务增加 lease、heartbeat、超时回收、可配置重试和指数退避。
- [ ] 为扫描、缓存、外部导入和媒体后处理定义幂等键与幂等恢复语义；应用重启后可安全恢复可重试任务，而非统一标记失败。
- [ ] 将 worker 抽象为可替换任务执行 capability，并提供明确的关闭排空、错误隔离和健康状态。
- [ ] 为 Agent 会话、工具调用、审批、插件状态和模型请求补充结构化审计日志、关联 ID、错误分类与管理界面。
- [ ] 使用真实模型 Key 和真实登录会话完成并记录一次端到端验证：对话、工具审批、Rust API 授权、外部媒体导入和结果回读。
- [ ] 为 Agent 配置、插件替换、任务领取、媒体外部导入和端口启动流程补齐集成测试与故障恢复测试。

### P1：Agent 能力产品化

- [ ] 将供应商管理从当前模型 provider 插件配置中抽成更完整的模型 capability：多协议适配器、连接测试、模型列表发现、失败降级和按 profile 选择。
- [ ] 完成 sandbox capability：为工具/MCP 提供进程、文件系统、网络、资源限制和运行记录，而非仅声明权限。
- [ ] 完成 scheduler capability：持久化计划、触发器、并发策略、重试、暂停/恢复和可视化运行历史。
- [ ] 将 skills 做成可导入、版本化、可启停的插件资源，支持下载包的元数据校验、依赖解析、更新和回滚。
- [ ] 将 MCP 管理做成可视化配置、连接测试、工具发现、启停、权限映射、运行状态和错误诊断；区分 stdio、HTTP/SSE 等连接方式。
- [ ] 将 knowledge-base 发展为完整知识库 capability：文档导入、解析、分块、索引、检索、引用来源、增量更新和删除。
- [ ] 建立插件包清单、版本、依赖解析、安装来源、更新与回滚工作流；本地发现仍保留为开发模式。
- [ ] 把 profile/overlay 暴露到设置页，支持按场景组合模型、策略、工具和插件配置，并可预览最终生效配置。
- [ ] 为复杂插件完善浏览器模块加载协议、版本兼容性、错误边界和宿主 API，避免 UI 扩展破坏主设置页。

### P2：领域边界与前端演进

- [ ] 将扫描后处理进一步下沉到各 `MediaTypeProcessor`；scanner 仅负责遍历、差异检测、事务和任务调度，新增媒体类型不再持续改动中心编排服务。
- [ ] 按 feature 收拢 Web 代码：完善 `features/music`、`features/libraries`、`features/agent` 等目录，将请求、查询状态、视图模型和 UI 拆分出超长页面与通用 API 门面。
- [ ] 引入查询缓存层，统一任务轮询、列表刷新、跨页面播放/阅读状态和失效策略。
- [ ] 为插件、模型供应商和策略补齐 HeroUI Table/Card 管理界面，覆盖状态、默认项、批量操作、筛选、详情与错误反馈。
- [ ] 提供 Agent 对话历史管理、工具执行时间线、审批列表、会话标题和可读的调用参数/结果展示。

### P3：媒体与平台扩展

- [ ] 增加游戏、动漫、电影、剧集等媒体类型的专用模型、扫描后处理、元数据 Provider、浏览页和播放器体验。
- [ ] 为音乐补充本地标签写回确认、授权的中文/私有元数据源、WebDAV 转码和更完整歌词体验。
- [ ] 为小说增加全文搜索、书签、批注、更多格式和跨设备阅读同步。
- [ ] 建立媒体元数据 Provider 插件协议、候选比对和人工确认工作流。
- [ ] 评估桌面封装、备份/导入导出、多实例或远程部署的产品形态。

## 运行数据与注意事项

- `api/data/` 与 `agent/data/` 是本地运行状态，已配置为 Git 忽略；不要手工删除，除非确认需要重置本地数据。
- `api/data/preview/` 保存照片预览、视频封面、小说封面和音乐专辑封面等派生缓存。
- 通过 HTTPS 或反向代理部署时设置 `COOKIE_SECURE=true`；日志级别通过 `RUST_LOG` 调整。
- 在引入来自外部的插件、Skill 或 MCP 前，应先确认其来源、启动命令、读写路径和网络行为。当前 Agent 架构已保留隔离能力的插槽，但尚未提供真正的安全沙盒。
