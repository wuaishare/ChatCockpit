# TokenPilot MCP 接入指南

## 能力状态

- 本地 MCP HTTP 传输：已实现
- REST/MCP 共用 Application Service 与 Parity 测试：已实现
- Exposed Mode 静态 Bearer 兼容鉴权：已实现
- ChatGPT 兼容 OAuth 2.1 Discovery、DCR、PKCE、Refresh、Revoke 与重启持久化：已实现并完成本地确定性验证
- 通过远程 ChatGPT 或其他 MCP 客户端使用：外部客户端与网络边界仍属实验性
- TokenPilot 公共托管 MCP 服务：未实现

TokenPilot 的 REST 与 MCP 使用同一套应用服务。MCP Handler 不会直接写 SQLite、独立抢占 Writer Lease，也不会绕过文件、命令、Git 与 public-safe 投影规则。

## 1. 启动 TokenPilot

```bash
npm run setup
npm run start:local
npm run doctor
```

默认本地 MCP 地址：

```text
http://127.0.0.1:4318/mcp
http://127.0.0.1:4318/tokenpilot/mcp
```

两条路径是别名。客户端配置时固定使用其中一条即可。

## 2. 鉴权

仅监听 `127.0.0.1` 且 `TOKENPILOT_EXPOSED=false` 时，可以在明确的本机私有环境中不设置 Bearer Token。

对于 ChatGPT Remote MCP，OAuth 是推荐接入方式。公网暴露至少配置：

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-owner-secret
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`TOKENPILOT_PUBLIC_BASE_URL` 是 OAuth 的唯一 Canonical Issuer Origin，只填 HTTPS Origin，不要追加 `/mcp`、Query、Credential 或 Fragment。OAuth 身份不会根据 `Host` / `X-Forwarded-Host` 动态变化。

ChatGPT 连接：

```text
https://tokenpilot.example.com/mcp
```

TokenPilot 会公开协议所需端点：

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
/oauth/revoke
```

授权使用 Public OAuth Client、PKCE S256、`tokenpilot:mcp` Resource Scope、短时 Access Token 与可跨重启继续使用的 Refresh Token。浏览器授权页要求输入现有 `TOKENPILOT_API_TOKEN` 作为本机 Owner Secret；它不会返回给 MCP 客户端，也不会作为 OAuth Token 明文落库。

默认 Redirect Host 只允许 HTTPS `chatgpt.com`，以及测试用 `localhost` / `127.0.0.1`。额外 Host 必须通过本机 `TOKENPILOT_OAUTH_ALLOWED_REDIRECT_HOSTS` 显式配置，而且实际 `redirect_uri` 仍必须与已注册 URI 完全一致。

静态 Bearer 继续用于本地 Operator 和兼容客户端：

```text
Authorization: Bearer <TOKENPILOT_API_TOKEN>
```

OAuth Access Token 刻意只授权 `/mcp` 与 `/tokenpilot/mcp`，不会顺便获得 REST Control Plane 权限。

不要把真实 Owner Secret、域名、Tunnel 凭据、OAuth 数据库或机器路径提交到 Git。

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

发布门禁会验证：静态 Bearer 兼容、OAuth Discovery / Registration / PKCE / Refresh / Restart / Revoke、Tool List、Tool Call、结构化错误、幂等，以及 `/mcp` 与 `/tokenpilot/mcp` 别名。

## 4. 工具分类

默认 exposed-mode 目录包含 62 个工具。本地非 exposed 模式，或 exposed deployment 显式设置 `TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED=true` 后，会额外注册 3 个受治理 Resource mutation 工具，总数为 65：

- Direct Drive Executor / Capability Discovery、public-safe Host Root Alias Discovery、受治理的 Host Direct 文件读取、审批式 Host Write / Exact Edit、审批式 bounded Host Command、TokenPilot-owned Managed Workspace Process `prepare/decide/execute/read/list`，以及 Workspace Files、Search、Shell、Git；
- Project、Workspace Snapshot、Task、Session、Writer Lease、Handoff、Evidence、Submit Review、受治理的 Completion 与 Continuity-bound Async Job Queue；
- Spec/Plan 创建、列表、读取、不可变历史版本读取、追加版本、生命周期与 Task 绑定；
- Codex Runtime Capability 与 Thread Metadata；
- Runtime Resource Center Inventory / Inspect，覆盖 Native Codex Skills/MCP/Plugins/config 摘要、Downstream MCP 资源与 ACP Registry Agents；受治理的 Codex Skill enable/disable 与 Codex Plugin install/uninstall 已通过共享 approval kernel 开放。MCP mutation surface 只包含 `tokenpilot.resources.mutation.prepare`、`tokenpilot.resources.mutation.inspect`、`tokenpilot.resources.mutation.execute`，明确不注册 MCP `decide` / `reconcile`。在 exposed mode 下，只有显式设置 `TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED=true` 才注册这 3 个工具；Remote MCP OAuth access token 也不能作为普通 REST mutation decision 的凭据复用；
- Codex Session Bind、Resume、Fork；
- 显式 Codex Turn、Interrupt、Approval Response 与 Event Read；
- Runtime Recovery 的 `tokenpilot.recovery.assess` 与 `tokenpilot.recovery.execute`。Assessment 会持久化五分钟 public-safe Recovery Attempt，但不会触发 Provider mutation；Execute 会重新验证同一 `assessmentHash` 后只执行一个显式动作。Recovery 不会隐式 `turn/start`、不会自动切换 Provider，也不会模糊选择外部 Thread。

客户端应读取实时 `tools/list`，不要把旧工具清单写死。

## 5. 本地下游 MCP Discovery

Downstream MCP Executor 使用独立的 local-only 配置 `~/.tokenpilot/direct-executors.json`（可通过 `TOKENPILOT_DIRECT_EXECUTORS_CONFIG_PATH` 覆盖）。这个文件不属于 Repo Governance，Remote MCP 也没有修改它的入口。

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
tokenpilot probe-direct-executors
```

或只 Probe 一个：

```bash
tokenpilot probe-direct-executors --executor-id 'downstream-mcp:example'
```

Probe 会完成 MCP Initialize 与 `tools/list`，使用官方 MCP Schema 校验响应，再把本地 Capability Snapshot 写入 `.tokenpilot/runtime/capabilities/downstream-mcp/`。只有显式 Mapping 的 Capability 才能进入 Broker，不会根据 Tool Name 前缀自动猜测，也不会在公共 Executor Descriptor 中暴露下游 Tool Name。

Desktop Commander 继续使用同一份 local-only 配置，并固定 Executor ID 为 `downstream-mcp:desktop-commander`。上游标准 stdio 启动方式是 `npx -y @wonderwhy-er/desktop-commander@latest`；TokenPilot 不会主动安装该包。但如果操作员显式运行使用这条 `npx` transport 的 Probe，而本机尚未缓存该包，`npx` 可能会在执行本地命令时下载并缓存它。当前 Desktop Commander Adapter 可以显式映射受治理的 Host Files 与 bounded Host Command normalized capability：

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

它会创建权限收紧的临时配置和临时只读 Host Root fixture，真实 Probe MCP Server，要求 `files.read` 已 verified，然后通过 ChatGPT-facing `tokenpilot.host.files.read` 完成读取；结束后删除临时 runtime/config/root。

Host Mutation Mapping 可用后，再运行 Write / Exact Edit 的 operator-only 实机证明：

```bash
npm run probe:desktop-commander-host-mutation-live
```

Mutation proof 只把选中的本机 Desktop Commander transport 复制到权限收紧的临时配置中，创建临时 `read + write` Host Root，真实 Probe `files.read/files.write/files.edit`，然后驱动真正的 ChatGPT-facing `tokenpilot.host.mutation.prepare` → `tokenpilot.host.mutation.decide` → `tokenpilot.host.mutation.execute` 生命周期。它会实际执行一次 rewrite 和一次 exact replacement，本机回读并核对最终内容/hash，同时检查公共结果没有泄露临时绝对路径，最后删除临时 config/runtime/root/database。若只是一次显式的 operator proof、不想先持久化本机 Executor，也可以在命令前设置 `TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest'`；这仍然只有在操作员主动执行 live-proof 命令时才会运行外部包。

当前受治理的 Host Command 使用 Desktop Commander 的 `start_process`，不再依赖旧 `execute_command`。`read_process_output` 与 `force_terminate` 只作为 TokenPilot Adapter 内部生命周期依赖，不会直接暴露为 Remote MCP Tool。运行 operator-only 实机证明：

```bash
TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-command-live
```

该 proof 会驱动真正的 `tokenpilot.host.command.prepare` → `tokenpilot.host.command.decide` → `tokenpilot.host.command.execute`：验证 Pure Host 只读命令、需要 Writer Lease/Git/Task Evidence 回流的 Workspace write-effect 命令，以及必须被强制终止且不能留下延迟子进程副作用的 bounded slow command。公共结果同时检查 PID、private cwd、环境变量和绝对路径泄露。真实外部 proof 不进入默认验证套件；protocol gate 使用确定性的 fake-MCP harness 跑同一 driver。

对于受治理的 Managed Workspace Process，TokenPilot 仍把 Desktop Commander 的 `start_process`、`read_process_output`、`interact_with_process`、`force_terminate` 保持为 Adapter 私有依赖；Remote MCP 只开放 TokenPilot 自己的 `tokenpilot.host.process.prepare`、`tokenpilot.host.process.decide`、`tokenpilot.host.process.execute`、`tokenpilot.host.process.read`、`tokenpilot.host.process.list`。Managed Process 只允许注册 Workspace，start/input 必须回到所属 chat-direct Session / Writer Lease；公共身份使用 `host_process_*`，不会暴露 PID，并记录 Process Audit / Task Evidence。运行 operator-only 实机证明：

```bash
TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-process-live
```

该 live proof 通过真正的 ChatGPT-facing Host Process 工具驱动 `start → read → input → list → stop`。它会验证 start/input 的新输出只在 Supervisor 内存中做 bounded 暂存并通过 `process.read` 读取，不会被 mutation idempotency 持久化；raw input 不进入 SQLite；PID/私有绝对路径不出现在公共结果；stop 必须取得 Desktop Commander 的明确 terminal state；停止后也不能产生预设的延迟副作用。默认 protocol gate 通过确定性的 `verify:desktop-commander-host-process-live-harness` 跑同一 driver。

对于 Durable Managed Process Supervisor 路径，TokenPilot 会把私有 Desktop Commander stdio/PID namespace 移到独立本机 sidecar。普通 Control Plane restart 必须保持 sidecar generation 与同一个公共 `host_process_*` 身份；Control Plane 离线期间，sidecar 仍通过只读 Continuity Database 独立检查所属 Writer Lease。Downstream MCP 进程由私有 process-group guardian 包裹，因此 sidecar 异常断开时可以收敛 Desktop Commander 进程树，而不需要持久化 PID 或根据旧 PID 重新 attach。运行最终 operator-only durability proof：

```bash
TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-durable-process-live
```

最终 durability 只认可 **`DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_PROOF_OK`**。同一个 driver 必须同时通过三个故障域：Control Plane restart continuity、Control Plane 离线期间 Writer Lease 失效自动收权，以及 Process Supervisor 被 hard-kill 后 managed child 仍不能留下延迟副作用。默认 protocol gate 中的 `verify:desktop-commander-durable-process-live-harness` 使用测试专用 abrupt sidecar exit，明确绕过 graceful `daemon.close()`，验证同一 guardian containment 路径。操作员也可以设置 `TOKENPILOT_DURABLE_PROCESS_PROOF_CRASH_MODE=abrupt-exit` 对真实外部包做诊断；该模式只会输出不同的 `DESKTOP_COMMANDER_DURABLE_PROCESS_ABRUPT_PROOF_OK`，**不能替代最终 hard-kill 发布门槛**。Raw downstream process tools、系统级进程 list/kill、persisted-PID adoption、socket 路径、sidecar token 与 private PID 都继续不进入 Remote MCP 合同。

Remote MCP 现在开放受治理的 Host Files、bounded Host Command 与 TokenPilot-owned Managed Workspace Process，而不是 raw downstream tools。`tokenpilot.host.roots.list` 只返回 public-safe Root Alias 与每个 Root 的 `read/write` 权限。Write / Exact Edit 走 `tokenpilot.host.mutation.prepare` → `decide` → `execute`；bounded command 走 `tokenpilot.host.command.prepare` → `decide` → `execute`；Managed Process 走 `tokenpilot.host.process.prepare` → `decide` → `execute`，并配合 `read/list`。Pure Host Command 仍只允许显式只读 policy；Workspace write-effect Command 与 Managed Process start/input 都必须回到 chat-direct 治理并记录 Evidence。Raw shell source、任意 PID attach、系统级 `list_processes` / `kill_process`、PID 以及 raw Desktop Commander Process Tools 都继续不对 Remote MCP 开放。

### Runtime Recovery 操作员证明

Runtime Recovery 只新增两个 Remote MCP Tool：`tokenpilot.recovery.assess` 与 `tokenpilot.recovery.execute`。Assessment 会持久化一个 5 分钟有效的 public-safe Recovery Attempt，但不会执行 Provider mutation；Execute 会在执行一个显式恢复动作前重新校验同一个 assessment hash。Recovery 不会隐式调用 `turn/start`、不会自动切换 Provider，也不会模糊选择外部 Thread。

默认 Recovery protocol gate 使用确定性的 scripted Codex runtime，并与实机 proof 共用同一个 A/B/C/D driver：

```bash
npm run verify:runtime-recovery
```

要对本机 TokenPilot 实际发现的 Codex App Server 做 Native Codex Recovery 实机证明，执行：

```bash
npm run probe:codex-runtime-recovery-live
```

操作员 proof 会先只读查找一条具有可访问 workspace `cwd` 的已有持久 Codex Thread，再通过 `thread/fork` 创建 proof-owned fork，全程不启动模型 Turn。临时 TokenPilot Continuity Database 位于该 Workspace 之外。Proof 必须同时证明：显式恢复已绑定 Thread；显式 Recovery Fork 产生不同 Thread ID 并保留 source relation；Compatibility Fingerprint 漂移会在任何 Provider Effect 前拒绝旧 Assessment；故意缺失的外部 Thread 不会被伪装成 Codex 恢复成功，只有存在显式 Ready Handoff 时才能接续到 Chat Direct。最终只认可 **`CODEX_RUNTIME_RECOVERY_LIVE_PROOF_OK`**，且 summary 必须报告 `turnStartObserved: false`。

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

1. 创建或读取 TokenPilot Task / Session；
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
tokenpilot.document.create
tokenpilot.document.list
tokenpilot.document.get
tokenpilot.document.version.get
tokenpilot.document.appendVersion
tokenpilot.document.updateStatus
tokenpilot.task.bindDocuments
```

Task 绑定会固定当前不可变的 `specVersion` 和 `planVersion`，文档后续追加新版本不会悄悄改写 Task 的执行依据。公共 Markdown 读取会脱敏常见绝对路径和凭据赋值，私有 SQLite 仍是真源。

## 6. Workspace Continuity

通过：

```text
tokenpilot.workspace.snapshot
```

读取一个工作区的 public-safe 连续性状态，包括：

- Active Writer Lease；
- Git 分支、HEAD、Dirty 与变更路径；
- Tasks 与 Sessions，包括固定的 Spec/Plan 版本 ID；
- 每个 Task 的最新 Handoff；
- Evidence Checklist 与保守验证状态；
- Pending Approvals。

绝对路径和原始 Runtime Request Body 不会返回。

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
