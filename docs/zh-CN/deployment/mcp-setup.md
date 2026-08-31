# ChatCockpit MCP 接入指南

## 能力状态

- 本地 MCP HTTP 传输：已实现
- REST/MCP 共用 Application Service 与 Parity 测试：已实现
- Exposed Mode 静态 Bearer 兼容鉴权：已实现
- ChatGPT 兼容 OAuth 2.1 Discovery、DCR、PKCE、Refresh、Revoke 与重启持久化：已实现，并已完成真实 ChatGPT custom MCP app 授权与调用验证
- 远程 ChatGPT / MCP 客户端长期稳定性：alpha 验证中，重点覆盖跨客户端、代理、refresh/reconnect 与长时间运行
- ChatCockpit 公共托管 MCP 服务：未实现

ChatCockpit 的 REST 与 MCP 使用同一套应用服务。MCP Handler 不会直接写 SQLite、独立抢占 Writer Lease，也不会绕过文件、命令、Git 与 public-safe 投影规则。

## 1. 启动 ChatCockpit

```bash
npm run setup
npm run start:local
npm run doctor
```

默认 canonical 本地 MCP 地址：

```text
http://127.0.0.1:4318/mcp
```

0.2.x 仍保留 receive-only legacy transport alias，但新的客户端配置应只使用 canonical `/mcp`。

P0.2 已把“底层能力是否存在”和“默认让模型看到什么”分离：

| 地址 | 用途 | 当前配置下工具数 |
|---|---|---:|
| `/mcp` | 默认普通开发核心面 | 16 |
| `/mcp/packs/<pack>` | Core + 一个显式专业能力包 | 依能力包而定 |
| `/mcp/full` | 完整兼容工具面 | 84 |
| `/tokenpilot/mcp` | 0.2.x 接收型旧兼容别名，对应完整面 | 84 |

默认 Core 覆盖项目/设备选择、public-safe 文件/搜索/命令/Git、执行轨迹、接力胶囊与 `chatcockpit.tools.discover`。发现工具只返回专业能力包及其 endpoint，并**不会**在已经建立的 MCP 连接里动态注入新工具；客户端需要专业能力时，应显式连接对应 `/mcp/packs/<pack>`，`/mcp/full` 只用于完整兼容。

## 2. 鉴权

仅监听 `127.0.0.1` 且 `CHATCOCKPIT_EXPOSED=false` 时，可以在明确的本机私有环境中不设置 Bearer Token。

对于 ChatGPT Remote MCP，OAuth 是推荐接入方式。公网暴露至少配置：

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-machine-api-secret
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

`CHATCOCKPIT_PUBLIC_BASE_URL` 是 OAuth 的唯一 Canonical Issuer Origin，只填 HTTPS Origin，不要追加 `/mcp`、Query、Credential 或 Fragment。OAuth 身份不会根据 `Host` / `X-Forwarded-Host` 动态变化。

ChatGPT 连接：

```text
https://chatcockpit.example.com/mcp
```

控制台管理员登录后可打开 `<安全入口>/integrations`，核对明确的本机/公网控制台入口、MCP 地址、OAuth 就绪状态、聚合授权计数和当前 MCP 工具目录数量。全新初始化会随机生成 `<安全入口>`；请从 App 或当前控制台进入 Integrations，不要再假定固定 `/ui`。该页面只投影状态，不会展示 OAuth Token、Client ID 或机器 API 凭据。

ChatCockpit 会公开协议所需端点：

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
/oauth/revoke
```

授权使用 Public OAuth Client、PKCE S256、`chatcockpit:mcp` Resource Scope、短时 Access Token 与可跨重启继续使用的 Refresh Token。浏览器批准要求已认证的控制台管理员会话，并使用与该会话绑定的 CSRF Token；授权页不要求输入 `CHATCOCKPIT_API_TOKEN`，OAuth readiness 也不依赖机器 API 令牌。如果浏览器尚未登录，ChatCockpit 只创建一次 Pending OAuth Request，经 `<安全入口>/login` 跳转，管理员登录后继续使用同一个 `request_id`。

默认 Redirect Host 只允许 HTTPS `chatgpt.com`，以及测试用 `localhost` / `127.0.0.1`。额外 Host 必须通过本机 `CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS` 显式配置，而且实际 `redirect_uri` 仍必须与已注册 URI 完全一致。

静态 Bearer 继续用于机器 API / 自动化工作流和兼容客户端：

```text
Authorization: Bearer <CHATCOCKPIT_API_TOKEN>
```

OAuth Access Token 可用于 canonical `/mcp`、显式 `/mcp/packs/<pack>`、`/mcp/full` 与兼容期 `/tokenpilot/mcp`。这些 MCP surface 共用 `chatcockpit:mcp` 权限，但都不会顺便获得普通 REST Control Plane 权限。

不要把真实控制台管理员密码/Session、机器 API Token、域名、Tunnel 凭据、OAuth/Operator 数据库或机器路径提交到 Git。

如果 ChatGPT custom MCP app 已经连接，建议直接按 [`../testing/chatgpt-connector-smoke.md`](../testing/chatgpt-connector-smoke.md) 做真实用户 smoke，而不是只停在 OAuth 成功页。

## 3. 验证 MCP Transport

通过 JSON-RPC 列出工具：

```bash
curl -sS http://127.0.0.1:4318/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

需要鉴权时再加入：

```bash
-H 'Authorization: Bearer replace-with-your-token'
```

发布门禁会验证：静态 Bearer 兼容、OAuth Discovery / Registration / PKCE / Refresh / Restart / Revoke、canonical 16-tool `/mcp`、`/mcp/full`、专业能力包路由、`tools.discover`、结构化输出契约、Mutation 幂等，以及 receive-only `/tokenpilot/mcp` 兼容别名。

## 4. 工具面与能力分类

canonical `/mcp` 不再把全部内部能力平铺给模型。当前配置下完整目录为 84 个工具，默认 Core 只有 16 个面向常规开发流程的工具，并且 16/16 都声明且由服务端实际校验 `outputSchema`。专业能力通过 8 个显式能力包提供：`capability-routing`、`host-admin`、`device-admin`、`workflow`、`continuity-governance`、`codex-native`、`runtime-admin`、`recovery`。仅为历史兼容保留的旧别名继续留在完整面，不进入专业能力包。

`chatcockpit.tools.discover` 只负责报告能力包、endpoint、专业工具数量与工具后缀，不伪造“调用后动态改变 tools/list”的非标准 MCP 行为。支持 Tool Search / allowed-tools 的客户端仍可在客户端一侧进一步延迟或过滤工具定义。

底层能力继续复用同一套 Application Services。Runtime Resource mutation 的 3 个工具仅在本地非 exposed 模式，或 exposed deployment 显式设置 `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true` 时注册：

- Direct Drive Executor / Capability Discovery、public-safe Host Root Alias Discovery、受治理的 Host Direct 文件读取、审批式 Host Write / Exact Edit、审批式 bounded Host Command、ChatCockpit-owned Managed Process `prepare/decide/execute/read/list`（Workspace scope + 显式 OAuth Full Access Pure Host scope），以及 Workspace Files、Search、Shell、Git；
- Capability Router 固定注册 `chatcockpit.capabilities.list`、`inspect`、`read.invoke` 与 `mutation.prepare`、`mutation.inspect`、`mutation.execute`。Provider-native Tool Name 只作为 Catalog 数据返回；MCP 不注册 Router `decide`。Mutation approve/deny 只能由已认证本地 Operator Session 通过 `/api/capabilities/mutations/decision` + CSRF 完成；
- Project、Workspace Snapshot、Task、Session、Writer Lease、Handoff、Evidence、Submit Review、受治理的 Completion 与 Continuity-bound Async Job Queue；
- Spec/Plan 创建、列表、读取、不可变历史版本读取、追加版本、生命周期与 Task 绑定；
- Codex Runtime Capability 与 Thread Metadata；
- Runtime Resource Center Inventory / Inspect，覆盖 Native Codex Skills/MCP/Plugins/config 摘要、Downstream MCP 资源与 ACP Registry Agents；受治理的 Codex Skill enable/disable 与 Codex Plugin install/uninstall 已通过共享 approval kernel 开放。MCP mutation surface 只包含 `chatcockpit.resources.mutation.prepare`、`chatcockpit.resources.mutation.inspect`、`chatcockpit.resources.mutation.execute`，明确不注册 MCP `decide` / `reconcile`。在 exposed mode 下，只有显式设置 `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true` 才注册这 3 个工具；Remote MCP OAuth access token 也不能作为普通 REST mutation decision 的凭据复用；
- Codex Session Bind、Resume、Fork；
- 显式 Codex Turn、Interrupt、Approval Response 与 Event Read；
- Runtime Recovery 的 `chatcockpit.recovery.assess` 与 `chatcockpit.recovery.execute`。Assessment 会持久化五分钟 public-safe Recovery Attempt，但不会触发 Provider mutation；Execute 会重新验证同一 `assessmentHash` 后只执行一个显式动作。Recovery 不会隐式 `turn/start`、不会自动切换 Provider，也不会模糊选择外部 Thread。

客户端应读取实时 `tools/list`，不要把旧工具清单写死。

## 5. 本地下游 MCP Discovery

Downstream MCP Executor 使用独立的 local-only 配置 `~/.chatcockpit/direct-executors.json`（可通过 `CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH` 覆盖）。这个文件不属于 Repo Governance，Remote MCP 也没有修改它的入口。

最小结构：

```json
{
  "schemaVersion": 1,
  "hostRoots": [
    {
      "id": "docs",
      "displayName": "Local Docs",
      "path": "/local/private/absolute/path",
      "access": ["read"]
    }
  ],
  "executors": [
    {
      "id": "downstream-mcp:example",
      "displayName": "Example local MCP",
      "transport": {
        "kind": "stdio",
        "command": "local-command",
        "args": []
      },
      "mappings": [
        {
          "capability": "files.read",
          "toolName": "exact_downstream_tool_name",
          "scopes": ["host"],
          "access": ["read"]
        }
      ]
    }
  ]
}
```

本机 Probe 全部已配置 Executor：

```bash
chatcockpit probe-direct-executors
```

或只 Probe 一个：

```bash
chatcockpit probe-direct-executors --executor-id 'downstream-mcp:example'
```

Probe 会完成 MCP Initialize 与 `tools/list`，使用官方 MCP Schema 校验响应，再把本地 Capability Snapshot 写入 `~/.chatcockpit/runtime/capabilities/downstream-mcp/`。只有显式 Mapping 的 Capability 才能进入 Broker，不会根据 Tool Name 前缀自动猜测，也不会在公共 Executor Descriptor 中暴露下游 Tool Name。

Desktop Commander 继续使用同一份 local-only 配置，并固定 Executor ID 为 `downstream-mcp:desktop-commander`。上游标准 stdio 启动方式是 `npx -y @wonderwhy-er/desktop-commander@latest`；ChatCockpit 不会主动安装该包。但如果操作员显式运行使用这条 `npx` transport 的 Probe，而本机尚未缓存该包，`npx` 可能会在执行本地命令时下载并缓存它。

在 macOS 上，ChatCockpit 管理的 LaunchAgent 使用确定性的 Runtime `PATH`：把已配置 `NODE_BIN` 所在目录放在系统默认目录之前。这样与当前 Node 同目录的 `npm` / `npx` 可以在后台 Runtime 中正常解析，同时不会继承交互式 shell 的任意 PATH。若某个 Executor 安装在其他目录，应在 local-only 配置里使用绝对 `transport.command`，或显式提供 `transport.env.PATH`。

当前 Desktop Commander Adapter 可以显式映射受治理的 Host Files 与 bounded Host Command normalized capability：

```json
{
  "id": "downstream-mcp:desktop-commander",
  "displayName": "Desktop Commander",
  "transport": {
    "kind": "stdio",
    "command": "npx",
    "args": ["-y", "@wonderwhy-er/desktop-commander@latest", "--no-onboarding"]
  },
  "mappings": [
    {
      "capability": "files.read",
      "toolName": "read_file",
      "scopes": ["host"],
      "access": ["read"]
    },
    {
      "capability": "files.write",
      "toolName": "write_file",
      "scopes": ["host"],
      "access": ["write"]
    },
    {
      "capability": "files.edit",
      "toolName": "edit_block",
      "scopes": ["host"],
      "access": ["write"]
    },
    {
      "capability": "shell.exec",
      "toolName": "start_process",
      "scopes": ["host"],
      "access": ["read", "write"]
    }
  ]
}
```

原有 operator-only 只读实机证明继续保留：

```bash
npm run probe:desktop-commander-live
```

它会创建权限收紧的临时配置和临时只读 Host Root fixture，真实 Probe MCP Server，要求 `files.read` 已 verified，然后通过 ChatGPT-facing `chatcockpit.host.files.read` 完成读取；结束后删除临时 runtime/config/root。

Host Mutation Mapping 可用后，再运行 Write / Exact Edit 的 operator-only 实机证明：

```bash
npm run probe:desktop-commander-host-mutation-live
```

Mutation proof 只把选中的本机 Desktop Commander transport 复制到权限收紧的临时配置中，创建临时 `read + write` Host Root，真实 Probe `files.read/files.write/files.edit`，然后驱动真正的 ChatGPT-facing `chatcockpit.host.mutation.prepare` → `chatcockpit.host.mutation.decide` → `chatcockpit.host.mutation.execute` 生命周期。它会实际执行一次 rewrite 和一次 exact replacement，本机回读并核对最终内容/hash，同时检查公共结果没有泄露临时绝对路径，最后删除临时 config/runtime/root/database。若只是一次显式的 operator proof、不想先持久化本机 Executor，也可以在命令前设置 `CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest'`；这仍然只有在操作员主动执行 live-proof 命令时才会运行外部包。

当前受治理的 Host Command 使用 Desktop Commander 的 `start_process`，不再依赖旧 `execute_command`。`read_process_output` 与 `force_terminate` 只作为 ChatCockpit Adapter 内部生命周期依赖，不会直接暴露为 Remote MCP Tool。运行 operator-only 实机证明：

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-command-live
```

该 proof 会驱动真正的 `chatcockpit.host.command.prepare` → `chatcockpit.host.command.decide` → `chatcockpit.host.command.execute`：验证 Pure Host 只读命令、需要 Writer Lease/Git/Task Evidence 回流的 Workspace write-effect 命令，以及必须被强制终止且不能留下延迟子进程副作用的 bounded slow command。公共结果同时检查 PID、private cwd、环境变量和绝对路径泄露。真实外部 proof 不进入默认验证套件；protocol gate 使用确定性的 fake-MCP harness 跑同一 driver。

对于受治理的 Managed Process，ChatCockpit 仍把 Desktop Commander 的 `start_process`、`read_process_output`、`interact_with_process`、`force_terminate` 保持为 Adapter 私有依赖；Remote MCP 只开放 ChatCockpit 自己的 `chatcockpit.host.process.prepare`、`chatcockpit.host.process.decide`、`chatcockpit.host.process.execute`、`chatcockpit.host.process.read`、`chatcockpit.host.process.list`。Workspace scope 的 start/input 必须回到所属 chat-direct Session / Writer Lease，并记录 Process Audit / Task Evidence；Pure Host scope 是独立的 OAuth Full Access-only 通道，要求 durable Supervisor，以 Host Process Authority 精确绑定 grant + actor，使用独立并发上限，并且不会伪造 Workspace Session/Lease/Evidence。两种 scope 的公共身份都使用 `host_process_*`，不会暴露 PID。运行 operator-only 实机证明：

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-process-live
```

该 live proof 通过真正的 ChatGPT-facing Host Process 工具驱动 `start → read → input → list → stop`。它会验证 start/input 的新输出只在 Supervisor 内存中做 bounded 暂存并通过 `process.read` 读取，不会被 mutation idempotency 持久化；raw input 不进入 SQLite；PID/私有绝对路径不出现在公共结果；stop 必须取得 Desktop Commander 的明确 terminal state；停止后也不能产生预设的延迟副作用。默认 protocol gate 通过确定性的 `verify:desktop-commander-host-process-live-harness` 跑同一 driver。

对于 Durable Managed Process Supervisor 路径，ChatCockpit 会把私有 Desktop Commander stdio/PID namespace 移到独立本机 sidecar。普通 Control Plane restart 必须保持 sidecar generation 与同一个公共 `host_process_*` 身份；Control Plane 离线期间，sidecar 仍通过只读 Continuity Database 独立检查 scope-specific authority：Workspace scope 校验 Session / Writer Lease / Workspace identity，Pure Host scope 校验 Host Process Authority。Downstream MCP 进程由私有 process-group guardian 包裹，因此 sidecar 异常断开时可以收敛 Desktop Commander 进程树，而不需要持久化 PID 或根据旧 PID 重新 attach。运行最终 operator-only durability proof：

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-durable-process-live
```

最终 durability 只认可 **`DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_PROOF_OK`**。同一个 driver 必须同时通过三个故障域：Control Plane restart continuity、Control Plane 离线期间 Writer Lease 失效自动收权，以及 Process Supervisor 被 hard-kill 后 managed child 仍不能留下延迟副作用。默认 protocol gate 中的 `verify:desktop-commander-durable-process-live-harness` 使用测试专用 abrupt sidecar exit，明确绕过 graceful `daemon.close()`，验证同一 guardian containment 路径。操作员也可以设置 `CHATCOCKPIT_DURABLE_PROCESS_PROOF_CRASH_MODE=abrupt-exit` 对真实外部包做诊断；该模式只会输出不同的 `DESKTOP_COMMANDER_DURABLE_PROCESS_ABRUPT_PROOF_OK`，**不能替代最终 hard-kill 发布门槛**。Raw downstream process tools、系统级进程 list/kill、persisted-PID adoption、socket 路径、sidecar token 与 private PID 都继续不进入 Remote MCP 合同。

Remote MCP 现在开放受治理的 Host Files、bounded Host Command 与 ChatCockpit-owned Managed Process，而不是 raw downstream tools。`chatcockpit.host.roots.list` 只返回 public-safe Root Alias 与每个 Root 的 `read/write` 权限。Write / Exact Edit 走 `chatcockpit.host.mutation.prepare` → `decide` → `execute`；bounded command 走 `chatcockpit.host.command.prepare` → `decide` → `execute`；Managed Process 走 `chatcockpit.host.process.prepare` → `decide` → `execute`，并配合 `read/list`。Workspace process start/input 继续绑定 Session + Writer Lease；Pure Host process scope 则要求显式 OAuth Full Access、durable Process Supervisor，并精确绑定 grant/actor；同一个 Full Access 授权关系还可以把通用一次性 Host 解释器/命令作为精确结构化 intent 执行。普通 Host 档继续保持保守。不提供不受治理的 raw-shell 端点、任意 PID attach、系统级 `list_processes` / `kill_process`、PID 投影或 raw Desktop Commander Process Tools。

### Runtime Recovery 操作员证明

Runtime Recovery 只新增两个 Remote MCP Tool：`chatcockpit.recovery.assess` 与 `chatcockpit.recovery.execute`。Assessment 会持久化一个 5 分钟有效的 public-safe Recovery Attempt，但不会执行 Provider mutation；Execute 会在执行一个显式恢复动作前重新校验同一个 assessment hash。Recovery 不会隐式调用 `turn/start`、不会自动切换 Provider，也不会模糊选择外部 Thread。

默认 Recovery protocol gate 使用确定性的 scripted Codex runtime，并与实机 proof 共用同一个 A/B/C/D driver：

```bash
npm run verify:runtime-recovery
```

要对本机 ChatCockpit 实际发现的 Codex App Server 做 Native Codex Recovery 实机证明，执行：

```bash
npm run probe:codex-runtime-recovery-live
```

操作员 proof 会先只读查找一条具有可访问 workspace `cwd` 的已有持久 Codex Thread，再通过 `thread/fork` 创建 proof-owned fork，全程不启动模型 Turn。临时 ChatCockpit Continuity Database 位于该 Workspace 之外。Proof 必须同时证明：显式恢复已绑定 Thread；显式 Recovery Fork 产生不同 Thread ID 并保留 source relation；Compatibility Fingerprint 漂移会在任何 Provider Effect 前拒绝旧 Assessment；故意缺失的外部 Thread 不会被伪装成 Codex 恢复成功，只有存在显式 Ready Handoff 时才能接续到 Chat Direct。最终只认可 **`CODEX_RUNTIME_RECOVERY_LIVE_PROOF_OK`**，且 summary 必须报告 `turnStartObserved: false`。

该 proof 可能会在用户 Codex 历史中创建 proof-owned Thread Fork，但不会启动模型 Turn，也不会修改 Workspace 文件。Provider Thread Preview 可以出现在当前 Assessment 响应中，但 Recovery Attempt 历史只持久化 public-safe identity/status 元数据，不保存 raw provider transcript、prompt、reasoning、stderr、认证数据、可执行文件私有路径或 Workspace 私有绝对路径。

## 6. 明确选择运行模式

### Chat Direct

当 ChatGPT 或当前 MCP 客户端应继续拥有模型循环时，使用普通文件、搜索、命令与 Git 工具。

每个结果都会标记：

```ts
{
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executionScope: "workspace" | "host";
  executor: string;
  selectionMode: "automatic" | "explicit";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
}
```

协议门禁已证明 Chat Direct 不会隐式调用 `turn/start`，也不会创建 Codex Thread。

### Codex Session

只有明确需要 Codex 拥有模型循环时，才使用 Codex Session 工具。

推荐顺序：

1. 创建或读取 ChatCockpit Task / Session；
2. Bind、Resume 或 Fork Codex Thread；
3. 显式启动 Turn；
4. 读取 Runtime Events；
5. 处理命令或文件变更 Approval；
6. 准备或消费 Handoff。

Bind、Resume、Fork 本身不会启动 Turn。

### Async Agent Job

更长的排队任务使用 Continuity-bound Async Job Queue。Queue 创建会固定 Task/Session/Binding 身份，Runner Claim 会校验关系，终态会记录 Evidence 并释放 Binding，重启对账可幂等修复中断的 SQLite 交接。

### Spec/Plan Continuity

通过以下工具管理持久化需求与执行计划：

```text
chatcockpit.document.create
chatcockpit.document.list
chatcockpit.document.get
chatcockpit.document.version.get
chatcockpit.document.appendVersion
chatcockpit.document.updateStatus
chatcockpit.task.bindDocuments
```

Task 绑定会固定当前不可变的 `specVersion` 和 `planVersion`，文档后续追加新版本不会悄悄改写 Task 的执行依据。公共 Markdown 读取会脱敏常见绝对路径和凭据赋值，私有 SQLite 仍是真源。

## 6. Workspace Continuity

通过：

```text
chatcockpit.workspace.snapshot
```

读取一个工作区的 public-safe 连续性状态，包括：

- Active Writer Lease；
- Git 分支、HEAD、Dirty 与变更路径；
- Tasks 与 Sessions，包括固定的 Spec/Plan 版本 ID；
- 每个 Task 的最新 Handoff；
- Evidence Checklist 与保守验证状态；
- Pending Approvals。

绝对路径和原始 Runtime Request Body 不会返回。

### Workspace 接入与已有 Codex Thread 交接

本机 Owner 可以在 `<安全入口>/continuity/projects` 使用“管理工作区 / 添加项目”：

1. 添加一个 **Workspace Discovery Root**，例如某个集中存放 Git 项目的父目录；
2. ChatCockpit 只做 depth-1、有上限、不跟随 symlink escape 的只读 Git 发现；
3. 从候选中显式选择一个子项目加入 ChatCockpit；
4. 只有这个精确 checkout 会进入 `workspaceAllowlist + repoMappings`，同级兄弟项目不会因为父目录获批而自动获得 AI 执行权限。

Discovery Root 是 machine-local path authority，因此添加、删除、扫描与项目导入只能从目标机器的 Owner Web 会话执行；Remote MCP 不提供本机路径管理工具。

对于已经存在的 Codex 会话，可以在目标 Workspace 的 Sessions 页面选择“导入 Codex 会话”，输入裸 Thread ID 或：

```text
codex://threads/<thread-id>
```

ChatCockpit 会先校验该 Thread 解析到的真实 Workspace。默认动作“交接给 ChatGPT（Chat Direct）”只会绑定原 Thread 作为来源、捕获受限的可见 user/assistant 历史、建立标准 Handoff 并创建 Chat Direct continuation；**不会调用 Codex `thread/resume`、`thread/fork` 或 `turn/start`**。

交接完成后，Remote MCP 可通过：

```text
chatcockpit.continuity.importedContext.read
```

按 durable `importId` 分页读取已导入历史。该工具不能接受任意本地 Codex Thread ID；单条消息、单页大小与消息数量都有硬上限，reasoning、命令输出、文件 patch、绝对路径、环境变量和原始工具 payload 都不会进入投影。

## 7. Mutation 安全规则

- 同一个 Idempotency Key 只用于完全相同输入的重试；
- 不同 Mutation 使用新 Key；
- 客户端超时后，不要因为结果不确定就换新 Key 重复执行；
- 遵守 `expectedRevision`；
- 写入前尊重当前 Writer Lease；
- 只有结构化 Evidence 明确为 `verified` 时，才可声称已验证。

## 8. 发布验证

```bash
npm run verify:oauth-store
npm run verify:oauth-flow
npm run verify:protocol-core
npm run verify:source-archive
```

OAuth 两条专项门禁分别验证 Token 只以哈希进入私有持久层，以及 ChatGPT 风格 `Discovery -> DCR -> PKCE -> Owner Approval -> Access/Refresh -> MCP -> Server Restart -> Refresh -> 新 MCP Session -> Revoke` 全链路。`verify:protocol-core` 会把 OAuth 与既有 MCP/REST、Continuity、Codex、Chat Direct 一起验证；源码包门禁证明没有 `.git` 元数据时仍可安装、构建、启动并提供 Control Plane API。
