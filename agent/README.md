# Mengnex Agent

The Agent Gateway is an independent Node.js process. Cordis owns plugin lifecycle and service composition; the gateway owns HTTP transport; the Rust API remains the only authority for authentication, media-library scope, database writes, and file operations.

## Cordis Runtime

The Agent entrypoint only creates the Cordis `Context`, Plugin Manager, and HTTP gateway. The following capabilities are installed through declarative built-in plugins and their dependencies:

- `agent-runtime`: the Tool registry, approval state, capability checks, risk policy, and tool execution.
- `file-storage`: model settings and session persistence.
- `openai-compatible-provider`: the OpenAI-compatible LLM adapter, which occupies the replaceable `model` capability slot.
- `agent-loop`: the bounded model/tool-call loop.
- `core-tools`: Mengnex Rust API tools.
- `hello-world`: a removable integration plugin.
- `mcp-client`: an installable local package that discovers tools from reviewed stdio MCP servers.
- `skills`: an installable local package that contributes system instructions to a conversation.
- `knowledge-base`: an installable local package that indexes trusted files below `agent/knowledge` and provides `knowledge.search`.

Each manifest declares `kind`, `dependencies`, `provides`, declared permissions, and optional exclusive `slots`. The Plugin Manager installs dependencies first, refuses to remove required plugins, and refuses to remove a plugin with active dependents. Installing a non-core provider in an occupied slot deactivates the prior provider, so model implementations can be exchanged without changing the gateway. `mengnex-core-tools` only registers tools through the `tools` service, so later media sync, recommendation, MCP, skill, knowledge-base, sandbox, scheduler, and UI integrations can be installed as independent plugins without changing the HTTP gateway.

`pluginManager` manages the trusted plugin registry. `GET/POST/PUT/DELETE /v1/plugins` provide list, install, configure/enable, and uninstall operations for Owner/Admin users. It persists plugin state in `agent/data/plugins.json`. The browser cannot upload executable plugin code; new plugins must be registered by the local Agent distribution first.

Local package discovery uses `agent/plugins/<plugin-id>/mengnex-plugin.json`. A package declares its id, entry, kind, dependencies, provided services, declared permissions, and its configuration contract. The loader only resolves entries inside `agent/plugins` and dynamically imports code only when the package is installed. Local packages are still trusted code: permission declarations are visible for review, but they are not yet an operating-system sandbox. Browser-side plugin management only edits package configuration; it never uploads or executes TypeScript/JavaScript.

`/settings/agent/policy` persists the execution mode (`request_approval`, `approve_high_risk`, or `full_access`) and capability allowlist. The setting takes effect on the next tool invocation. Critical-risk tools still require explicit approval. Use the plugin page's JSON configuration editor for package-specific configuration: `skills` accepts `{ "skills": [{ "id": "...", "instruction": "..." }] }`; `knowledge-base` accepts `{ "paths": ["."] }`; `mcp-client` accepts `{ "servers": [{ "id": "example", "command": "...", "args": [] }] }`.

## Run

```powershell
cd agent
pnpm install
pnpm dev
```

Endpoints:

- `GET /health`
- `GET /v1/tools`
- `GET /v1/sessions`
- `POST /v1/sessions`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/messages` with `{ "content": "find EVA" }`
- `POST /v1/runs` with `{ "tool": "media.search", "args": { "query": "eva" } }`
- `POST /v1/approvals/:id` with `{ "decision": "approve" }`
- `GET/PUT /v1/policy`

The browser forwards its existing Mengnex HttpOnly session cookie to the local gateway. The Rust API therefore remains responsible for user, role, and media-library authorization. The initial tools are media search, task listing, scan-task creation, external-media import, and the `hello-world.health` Cordis plugin example. The execution mode is persisted through the Agent settings page; environment variables remain a startup fallback. Critical tools always require approval.

Conversations and their tool-call records are stored in `agent/data/sessions.json`, isolated by the authenticated Mengnex user id. Approvals are stored in `agent/data/approvals.json`, so an Agent Gateway restart does not lose pending user decisions.
