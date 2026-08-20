# Mengnex Agent 后续开发计划

## 1. 目标与边界

M e n g n e x 的核心产品仍是本地媒体资源库。Agent 是面向本地计算机与媒体资产的可扩展执行层：它可以检索和整理媒体、执行受控的本机操作、安装扩展、编写插件，并通过工作流持续完成长任务。

目标架构：

```text
Web / Desktop UI
  -> Agent Gateway (HTTP, SSE, 管理门面)
  -> Cordis Host (插件生命周期、依赖、capability 组合)
  -> Agent / Workflow / Subagent
  -> capability seams
       |- Media: catalog, libraryAccess, scanner, tasks, metadata, import
       |- Local computer: workspace, fs, shell, terminal, codeRuntime, lsp
       |- Runtime: llm, credentials, settings, approval, session, events
       |- Operations: jobs, sandbox, workflow, packageRegistry, subagents
  -> Rust API (媒体数据、权限、媒体任务与文件业务权威)
```

设计约束：

1. Cordis 内核只负责插件挂载、卸载、依赖、slot 替换和组合；所有业务能力由插件提供。
2. Rust API 仍是媒体数据、授权、文件业务与媒体任务的权威。Agent 不直接连接媒体数据库。
3. 本机操作、代码执行、安装包和远程插件必须通过可替换 capability 执行，不能散落在 HTTP Gateway 或页面中。
4. 早期开发允许破坏性更新；每个阶段完成后删除旧兼容路径，不同时维护两套实现。
5. DeepSeek Harness（DSH）是 capability seam、Host/Client 双端插件与组合模型的参考，不是要复制其 Coding Agent 产品功能。

## 2. 当前基线

已落地：

- Cordis Plugin Manager：依赖排序、slot 替换、级联暂停、配置、版本快照与回滚。
- Agent Gateway Facade、会话、审批、执行策略、事件审计、SSE 对话输出。
- OpenAI-compatible 模型插件与供应商实例管理页面。
- 媒体领域 seams：`mediaCatalog`、`libraryAccess`、`mediaScanner`、`mediaTasks`、`mediaMetadata`、`externalMediaSources`。
- 本地 JSON 会话/审批/插件状态/供应商持久化。
- 单机 scheduler 与本地进程 sandbox 的初版实现。
- 本地受信任插件发现、manifest、前端 HeroUI 设置模块、skills、knowledge-base、MCP 示例。

当前缺口：

- 模型、设置、凭据尚未拆为完整独立 seam。
- shell、terminal、workspace、fs、code runtime、LSP 尚未作为 Agent capability 提供。
- 没有 package registry、远程包下载、lockfile、依赖解析、实际包安装或 DSH compatibility host。
- scheduler 没有跨进程 lease、heartbeat、cron、并发策略或可恢复工作流。
- 浏览器插件 UI 仅支持单模块加载，不具备 DSH 风格的客户端模块图。

## 3. 插件与包模型

### 3.1 三类包

| 类型 | 目的 | 运行方式 |
| --- | --- | --- |
| Mengnex Native Plugin | Mengnex 自有媒体能力、工具、设置和 UI | `mengnex-plugin.json` + Cordis 插件 |
| DSH-Compatible Plugin | 复用 DSH 的服务契约或双端插件能力 | DSH compatibility host adapter |
| External Package | 来自远程仓库的已安装包 | 下载、校验、锁定、解析后按上述运行时加载 |

### 3.2 兼容目标

“兼容 DSH 插件”分级实施：

1. **配置兼容**：读取 DSH 风格 manifest、settings 和 credential reference。
2. **Host capability 兼容**：提供 `llm`、`settings`、`credentials`、`tools`、`session`、`jobs`、`sandbox` 等 DSH 服务契约适配器。
3. **客户端兼容**：支持 DSH boot manifest、模块 revision、依赖图和受控浏览器模块加载。
4. **包兼容**：能安装并运行明确声明兼容范围的 DSH 包。

不承诺任意 DSH 包零修改运行。依赖 DSH 专有 coding、桌面或未实现 capability 的包必须显式报告缺少能力，不能静默降级。

### 3.3 包状态机

```text
discovered -> downloaded -> verified -> resolved -> installed -> enabled -> active
                                        |                         |
                                        +-> blocked               +-> failed

installed -> updating -> installed
installed -> rollback -> installed
enabled -> disabled -> enabled
```

每次状态变化必须写入审计记录，并关联包版本、依赖 lockfile、执行者和错误信息。

## 4. 开发阶段

## Phase 0：运行时基础收敛

### 目标

让已有 seam 从“可替换接口”提升为“可稳定组合的运行时服务”。

### 工作项

- [ ] 引入 `SettingsProvider` seam：命名空间、schema、revision、watch、原子 mutate 和更新事件。
- [ ] 引入 `CredentialProvider` seam：仅保存 secret/reference；模型与 MCP 配置只保存 credential reference。
- [ ] 将 `FileProviderRegistry` 拆为模型配置 registry 与 credential provider。
- [ ] 引入 `LlmAdapter` registry：adapter 注册、模型目录、模型发现、模型 metadata、失败分类、连接测试。
- [ ] 将默认模型选择拆为 `ModelSelection` capability，支持 profile 覆盖。
- [ ] 收敛 Gateway 为三个门面：conversation、administration、observability；HTTP 路由不直接了解具体 capability。
- [ ] 为所有配置、凭据、模型调用、工具调用和插件变更写入带 correlation ID 的结构化审计事件。

### 验收

- 可在不改 Agent Loop 的前提下替换 settings、credentials、llm adapter 或 model selection provider。
- 模型供应商页面能执行连接测试与模型发现；密钥永不返回浏览器。
- 修改 settings/credentials 后，相关插件可通过 typed event 安全重载。

## Phase 1：本机工作区与文件能力

### 目标

让 Agent 能够管理本地媒体工作区与插件工程，但不绕过 Rust 的媒体业务与授权。

### 新增 capability

- `workspaceRegistry`：注册媒体根目录、Agent 工作目录、插件目录和临时目录。
- `filesystem`：读取、写入、枚举、移动、复制、哈希、文件观察和受控删除。
- `mediaFilesystem`：将媒体实体、文件路径和 Rust API 权限校验映射到本机文件操作。
- `directoryPicker`：供 UI 选择并注册本机目录。
- `fileReferences`：为会话、工具结果、媒体条目和工作流产物建立引用。

### 工作项

- [ ] 定义路径能力令牌，禁止直接传入未注册绝对路径。
- [ ] 定义 Agent workspace、媒体只读 workspace、插件开发 workspace、临时 workspace。
- [ ] 提供原子写入、回收站移动、hash、预览和文件变更事件。
- [ ] 将 Rust 媒体库权限与 `mediaFilesystem` 绑定；Agent 不能仅凭路径越过 library access。
- [ ] 提供文件操作工具：列表、检查、复制、移动、重命名、归档、预览和删除到回收站。
- [ ] 为每个文件操作记录来源、影响范围、回滚信息和关联媒体条目。

### 验收

- Agent 可在授权媒体库中找出重复文件、缺失封面和异常命名，并生成可审阅变更计划。
- 文件写入无法离开注册 workspace；删除默认进入可恢复回收站。
- 同一能力可被本地、WebDAV materialization 或未来远程 fs provider 替换。

## Phase 2：Shell、Terminal、代码运行时与 LSP

### 目标

让 Agent 可以执行媒体处理脚本、诊断本机环境、开发/测试插件并获得代码诊断能力。

### 新增 capability

- `shell`：一次性命令执行接口。
- `terminals`：持久 PTY 会话、输入输出流、结束状态和超时管理。
- `codeRuntime`：Node.js、Python、worker thread 等运行时 provider。
- `lsp`：语言服务启动、诊断、定义跳转、符号查询与代码操作。
- `subprocess`：底层进程 spawn seam，供 shell、terminal、LSP、媒体工具共享。

### 工作项

- [ ] 将现有 `LocalProcessSandbox` 下沉为 `subprocess` provider，并由 shell/terminal/codeRuntime 调用。
- [ ] 增加 PTY session 生命周期：创建、写入、订阅、终止、超时、审计、重连。
- [ ] 增加 Node/Python runtime provider，支持以 workspace 文件或内联代码执行。
- [ ] 增加 TypeScript/JavaScript、Python 的 LSP provider；首期覆盖插件开发 workspace。
- [ ] 增加媒体专用命令封装：ffprobe、ffmpeg、exiftool、文件 hash，不让模型自行拼接所有媒体命令。
- [ ] 为每个执行器定义资源预算：超时、输出上限、工作目录、环境、网络和可执行文件策略。

### 验收

- Agent 可在插件 workspace 生成 TypeScript 插件，运行类型检查、读取诊断并修复后测试。
- Agent 可在媒体 workspace 运行受控 ffprobe/ffmpeg/exiftool 任务并将结果关联回媒体条目。
- shell、terminal、codeRuntime、LSP 均能通过 provider slot 替换。

## Phase 3：沙盒与执行策略升级

### 目标

将本机执行从“白名单子进程”升级为多 provider 的一致执行平台。

### 工作项

- [ ] 定义 `SandboxProvider` 的完整运行模型：mount、workspace、network、environment、resources、artifact、cleanup。
- [ ] 实现 local、container、remote 三类 sandbox provider。
- [ ] 接入 Docker/Podman provider，支持镜像、挂载白名单、CPU/内存限制和网络策略。
- [ ] 增加执行计划/审批快照：批准后执行的是不可变 command、mount、env 和 artifact 计划。
- [ ] 增加产物收集、日志分段、运行记录和失败重放。
- [ ] 将 MCP server、代码 runtime、LSP、外部包 post-install 全部迁移到 sandbox 执行。

### 验收

- 同一 workflow 可在 local 或 container sandbox 中运行。
- 用户可追溯任一命令的输入、环境、输出、产物与媒体影响。
- 高风险执行审批绑定 immutable execution plan，而非仅工具名称和参数。

## Phase 4：DSH Compatibility Host

### 目标

逐步兼容 DSH 的通用插件架构，使适配范围明确、缺失能力可诊断。

### 工作项

- [ ] 新增 `dsh-host-runtime` 插件，提供 DSH package manifest 读取与 capability 检查。
- [ ] 适配 DSH `settings`、`credentials`、`llm`、`tools`、`session`、`jobs`、`sandbox` 服务契约。
- [ ] 定义 capability mapping manifest：DSH capability -> Mengnex capability/provider。
- [ ] 支持 DSH package peer dependency 与 capability version 检查。
- [ ] 为不支持的 DSH capability 输出结构化 diagnostics，不允许在运行时模糊失败。
- [ ] 建立 compatibility test fixtures：LLM、settings、credential、skill、MCP、UI slot 各至少一个真实 DSH 包。

### 验收

- 可安装并运行声明仅依赖已映射 capability 的 DSH 包。
- UI 可展示包的兼容状态、缺失 capability、版本约束和解决建议。
- DSH 包无法访问 Mengnex 未授权的媒体目录或凭据。

## Phase 5：浏览器模块图与插件 UI Runtime

### 目标

将当前单模块 Blob loader 升级为 DSH 风格的受控客户端模块图。

### 工作项

- [ ] 定义 browser boot manifest：id、url、revision hash、inject、external、load stage。
- [ ] 实现模块下载缓存、依赖顺序、factory registry、生命周期与失效刷新。
- [ ] 为 React/HeroUI 提供宿主单例，插件不得打包私有 React。
- [ ] 提供 typed UI slots：settings navigation、settings content、media detail action、agent conversation action、workflow inspector。
- [ ] 增加模块版本兼容性、错误边界、加载失败诊断和安全回退 UI。
- [ ] 支持 DSH-compatible client module 的受控加载。

### 验收

- 一个复杂插件可同时贡献设置表单、媒体详情动作和 Agent 对话卡片。
- 插件依赖的浏览器模块能按 manifest 正确加载、缓存和更新。
- 任一插件 UI 加载失败不影响主设置页或媒体浏览页。

## Phase 6：远程包仓库、安装和升级

### 目标

支持受控远程包分发，供 Agent 安装 skill、MCP、Native Plugin 和 DSH-Compatible Plugin。

### 新增 capability

- `packageRegistry`：查询仓库索引、包元数据、版本与兼容性。
- `packageInstaller`：下载、校验、解包、依赖解析、lockfile、激活、回滚。
- `packageTrust`：来源、签名、哈希、权限声明和本机策略。

### 工作项

- [ ] 定义 registry index 和 package manifest v1。
- [ ] 支持 Git、HTTP registry、本地归档三类来源。
- [ ] 实现 content hash、签名校验、依赖 lockfile、离线缓存和原子安装目录。
- [ ] 实现 semver dependency solver；安装前显示依赖树、权限和冲突。
- [ ] 增加包升级、回滚、卸载、损坏恢复和垃圾回收。
- [ ] 将插件状态从“本地发现版本”升级为“已安装 package resolution”。
- [ ] 为 Agent 提供 package search/install/upgrade 工具，所有写操作进入审批与 workflow。

### 验收

- 用户可从仓库选择包、预览依赖/权限、安装、启用、回滚。
- Agent 可生成插件、运行测试、打包并安装到本机 registry。
- 包安装失败不会破坏当前活跃插件；安装目录和 lockfile 保持一致。

## Phase 7：Subagent、团队协作与 Workflow

### 目标

支持长链路、可恢复的媒体维护与插件开发任务。

### 新增 capability

- `subagents`：创建子 Agent、任务上下文、结果汇总、取消和资源预算。
- `agentTeams`：角色、共享目标、消息和任务所有权。
- `workflowEngine`：声明式步骤、条件、等待、审批、重试、补偿与持久化状态。
- `workflowRegistry`：由插件注册媒体整理、元数据、插件开发等 workflow。

### 工作项

- [ ] 将现有 JobScheduler 升级为 workflow execution backend。
- [ ] 定义 workflow run、step run、artifact、approval、checkpoint 和 compensation 数据模型。
- [ ] 支持顺序、并行、fan-out/fan-in、等待用户、等待外部任务、定时触发。
- [ ] 支持子 Agent 拆分任务，例如检索元数据、分析文件、编写插件、测试插件。
- [ ] 建立媒体首批 workflow：重复媒体整理、缺失元数据补全、封面修复、格式转换、外部导入审核。
- [ ] 建立插件首批 workflow：需求 -> 生成 -> LSP 检查 -> 测试 -> 打包 -> 审批安装。

### 验收

- 任一长任务可在 Agent 重启后从 checkpoint 恢复。
- 用户可在 UI 查看步骤时间线、子 Agent 输出、审批点、产物和失败原因。
- 媒体写入与文件变更均能追溯到 workflow run。

## Phase 8：可靠任务与多节点执行

### 目标

将单机执行器演进为可选择的本机/远程 worker 平台。

### 工作项

- [ ] 将 job persistence 从 JSON 迁移到数据库或专用队列 provider。
- [ ] 实现 lease、heartbeat、visibility timeout、stale recovery、幂等键和去重。
- [ ] 实现 worker registration、capability labels、容量、健康检查和 drain。
- [ ] 定义本机媒体资源对远程 worker 的传输/挂载策略；默认不将隐私媒体自动发送至远程。
- [ ] 支持任务路由：本机文件操作优先 local worker，纯模型/元数据任务可路由远程 worker。
- [ ] 为 scheduler、workflow、sandbox、subagent 统一 execution record 和 retry policy。

### 验收

- 多 worker 不会重复执行同一媒体写任务。
- worker 中断后任务依 lease 过期安全恢复。
- 用户可按任务查看执行节点、重试、资源消耗和最终产物。

## 5. 媒体优先的首批产品闭环

通用能力完成时必须同时落到媒体场景，避免形成与产品脱节的 Agent 平台。

### 5.1 智能媒体整理

```text
用户目标 -> Agent 规划 -> 文件/媒体分析子任务
  -> 展示重命名、移动、去重计划 -> 审批
  -> workflow 执行 -> Rust 更新索引 -> 结果与可回滚记录
```

### 5.2 元数据补全

```text
缺失元数据扫描 -> 外部/本地 metadata provider
  -> 候选差异与置信度 -> 审批
  -> Rust API 原子写入 -> 媒体库重索引
```

### 5.3 插件自升级

```text
需求 -> Agent 创建插件 workspace -> 生成代码
  -> LSP/测试 -> package build -> 权限与变更审查
  -> 安装/启用 -> health check -> 可回滚 revision
```

### 5.4 媒体知识库

```text
媒体条目、笔记、字幕、说明文档
  -> parser/chunker/indexer plugin
  -> media-aware retrieval
  -> Agent 回答附带媒体实体和引用来源
```

## 6. 执行优先级

### P0：下一阶段

1. Phase 0：settings、credentials、LLM adapter registry。
2. Phase 1：workspace/fs 与 mediaFilesystem。
3. Phase 2：subprocess、shell、terminal、codeRuntime；先服务媒体工具和插件开发。

### P1：可扩展与可安装

4. Phase 3：container/remote sandbox。
5. Phase 4：DSH compatibility host 的 Host capability 子集。
6. Phase 5：客户端模块图与 typed UI slots。
7. Phase 6：远程包仓库、lockfile、安装和回滚。

### P2：长任务与规模化

8. Phase 7：workflow、subagent、团队协作。
9. Phase 8：lease、远程 worker 与分布式执行。

## 7. 质量门槛

每个 phase 合并前必须满足：

- [ ] capability 有独立 TypeScript 契约、至少一个实现和可替换 fake 测试。
- [ ] 插件启停、slot 替换、依赖级联和失败清理有测试。
- [ ] Host 与 Client 若均存在，必须有 manifest、version 和错误边界测试。
- [ ] 所有持久化状态有 schema version、恢复策略和并发写入策略。
- [ ] 媒体写操作都经 Rust API 授权或明确的 `mediaFilesystem` 授权适配层。
- [ ] 工具、工作流、shell、安装和删除操作都有 correlation ID 和审计记录。
- [ ] 至少有一个真实媒体库闭环验证，不只通过 mock 单元测试。
- [ ] 每阶段更新 `README.md`、`agent/README.md`、`CHANGELOG.md` 和待落地清单。

## 8. 明确不做的捷径

- 不在 Web 浏览器中直接执行插件 Host 代码、shell 或安装脚本。
- 不让 Agent 绕过 Rust API 直接改 SQLite 或任意媒体目录。
- 不把 DSH 包简单复制到 `agent/plugins` 后假定可运行。
- 不将远程 worker 默认授予本机媒体路径或私有凭据。
- 不为了“插件化”把稳定的媒体领域规则拆散；媒体权限、索引一致性和文件事务仍由 Rust 领域模块保持权威。
