# API 契约同步

后端的 Utoipa 声明是 API 契约的唯一数据源。修改 Rust 路由、请求体或响应体后，在 `web` 目录执行：

```powershell
pnpm api:sync
```

该命令会依次：

1. 运行 Rust 的 `export_openapi` 二进制，将规范导出到 `openapi/mengnex.json`。
2. 使用 HeyAPI 根据规范重新生成 `src/api/generated` 中的 TypeScript 类型和 SDK。

业务页面应通过 `src/api/client.ts` 中的适配函数访问 API。该文件负责 Cookie、未登录跳转和媒体 URL 规范化；`src/api/generated` 下的文件均为生成物，不应手工修改。

只需重新生成前端客户端时，可以执行 `pnpm api:generate`。后端仍可使用 `cargo run` 正常启动；单独导出规范则使用 `cargo run --bin export_openapi -- <输出路径>`。
