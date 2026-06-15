# 更新日志

## Unreleased

### 新增

- 创建 Rust `api` 服务，包含 Axum、SeaORM、SQLite、`api/data` 数据目录、OpenAPI 输出、Swagger UI，以及面向 Web 客户端的 CORS 配置。
- 增加媒体管理的基础数据结构：媒体库、扫描任务、共享媒体项/文件，以及专用照片资源表。
- 增加照片媒体库的文件系统扫描能力，支持写入数据库并通过 API 端点流式读取本地媒体文件。
- 在 Web 应用中增加首选项和媒体库管理设置页。
- 增加 `@hey-api/openapi-ts` 生成流程与类型安全的前端 API 客户端。
- 更新照片图库页面，通过 API 加载已扫描照片，并使用现有图库与查看器组件展示。

### 变更

- API 的 UUID 改为以文本字符串写入 SQLite，避免数据库查看时出现二进制 UUID 内容。
- API 源码结构调整为 `core`、`infra` 和功能 `modules`。
- 将仓库忽略规则集中到根目录 `.gitignore`。

### 修复

- 通过允许本地 IP 图片优化，修复 Next Image 无法加载本地 API 图片的问题。
- 修复前端对 hey-api 生成客户端响应的解包逻辑。
- 将设置页移动到 `(setting)` 路由组下，修复设置路由布局残留问题。
