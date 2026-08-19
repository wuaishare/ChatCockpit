# ChatCockpit 本地优先控制面架构

## 能力状态

- 已实现：CLI、Fastify Control Plane、REST/MCP/OpenAPI、Chat Direct、Codex Session Adapter、Continuity Engine、Queue/Runner 与 Web UI
- 实验性：Custom GPT Actions、Remote MCP、公网 HTTPS、Codex App Server Standalone
- 近期方向：Remote MCP 稳定性、Direct Drive 硬化、Codex Session 生命周期可靠性、Async Agent Job 可靠性，以及受治理的 Host Direct Scope

ChatCockpit 是一个以 ChatGPT 为主要对话入口、本地优先的 **AI 开发连续性与 Agent 能力路由平台**。

ChatGPT Native 是入口与模型循环宿主，不再与本地执行模式排成一条线性“升级链”。当任务需要本机执行时，由 ChatCockpit 进入三种显式执行模式之一：

```text
ChatGPT Native
  -> ChatCockpit Remote MCP / Control Plane
       -> Direct Drive
            -> Workspace Direct（已实现）
            -> Host Direct（Files + 审批式 bounded Command 已实现）
       -> Codex Session
       -> Async Agent Job
```

ChatGPT 负责对话、意图、规划与审查。在 Direct Drive 中，ChatGPT 同时保持唯一模型循环，ChatCockpit 只负责确定性执行；进入 Codex Session 后，模型循环被显式委托给 Codex；进入 Async Agent Job 后，由被委托的 Agent Runtime 在后台持有模型循环，而 ChatCockpit 管理 Job 生命周期。ChatCockpit 始终负责持久身份、执行策略、连续性状态、Public-safe Projection 与跨运行模式 Handoff。

## 控制面职责

当前 Control Plane 提供：

- 共用 Application Service 的 REST 与 MCP；
- 面向 Custom GPT Actions 的 OpenAPI；
- 通过 `projectId`、`workspaceId`、`repoId` 管理项目，不向远程客户端暴露绝对路径；
- Chat Direct 文件、搜索、受控命令与 Git 路由；
- Codex Thread List/Read/Bind/Resume/Fork；
- 显式 Codex Turn、Interrupt、Approval 与 Event；
- SQLite Continuity Store；
- Workspace Continuity Snapshot；
- File-backed Job Queue 与本地 Runner；
- Public-safe Artifact、Git、Handoff、Evidence、Approval 与 Runtime Event Projection；
- 稳定且不持久化的 `local-device` Target Projection，只包含 Platform 与 Architecture，不包含 hostname、机器 UUID 或 Fleet 状态；
- 协议、隐私、重启恢复和无 `.git` 源包门禁。

## 运行模式

### Direct Drive — Workspace Direct 与受治理 Host Files / bounded Command 已实现

Direct Drive 是“ChatGPT 保持唯一模型循环、ChatCockpit 执行确定性本机操作”的产品级总称。为保持现有持久化合同兼容，底层 Runtime Lane 仍使用 `chat-direct`。

Direct Drive 分为两个执行 Scope：

- **Workspace Direct — 已实现：** 只在显式允许的 Project/Workspace 内操作，并继续使用现有 Path、Command、Git、Writer Lease、Evidence 与 Public-safe Projection 治理。
- **Host Direct — 已实现受治理 Files 与 bounded Command：** Remote MCP 可以读取小型 text-like 文件，并在 Root 包含 `write` 时执行受审批的文本 Write / Exact Edit；同时可以通过独立 Direct Command Approval 生命周期执行 bounded non-interactive Host Command。文件变更继续受 canonical containment、symlink/sensitive-path 阻断、64 KiB 文本上限、exact mutation hash 与写后校验约束。Host Command 只接受结构化 `command + args + relative workdir`，不接受 raw shell source；Pure Host 仅允许显式只读 policy，Workspace write effect 必须回流 chat-direct Session、Writer Lease、Git 与 Task Evidence。公共输出有界且不暴露 PID/private cwd；系统级任意进程 attach/list/kill 仍未开放。

Direct Drive 已确认采用 **ChatCockpit Capability Broker + Pluggable Downstream MCP Executor** 架构。

**Capability Provider Kernel — 已实现：** ChatCockpit 现在定义了 Provider-neutral 的公共 Descriptor，用于表达 Provider 身份、Protocol Family、Compatibility/Auth 状态、public-safe reason 与标准化 Capability ID。现有 Runtime Profile 直接继承该公共 Descriptor，公开字段形态不变；Direct Executor 则通过兼容 Projection 进入同一 Provider 模型。通用 Provider Registry 负责 Source 隔离、确定性排序、标准化与重复 Identity 拒绝。当前 Direct Broker 与 Runtime Profile Registry 仍分别保持执行与 Inventory Authority；新 Kernel 当前只提供标准化组合能力。

**Resource Center Provider Projection — 已实现：** 现有 Runtime Profile Endpoint 现在会在保持 `profiles` 兼容字段不变的同时，额外返回 public-safe 的 `local-device` Target 与标准化 Provider Descriptor。当前 Resource Inventory 与 Mutation 流程仍以 Runtime Profile 为 Authority，因此这层 Projection 只建立通用管理平面 Seam，不改变现有资源中心行为。

**Platform Governance 存储边界 — 已实现：** `GovernanceLedger` 是平台治理的逻辑依赖边界。现有 Governance 兼容仓储与新增 Provider-neutral Governed External Action 刻意共用同一个 machine-local `continuity.sqlite` 物理文件，但使用彼此独立的逻辑 Migration Table。这样只拆依赖方向，不提前拆物理存储，也不改变既有 Continuity Schema Version 合同。Governed External Action Approval 只持久化 Target/Provider/Tool 身份、Arguments Hash、Public Summary、Actor/Request Identity Hash、Lifecycle Timestamp/Status 与 Execution Outcome Status；原始调用参数和 Provider Result 正文都不会持久化。

**Capability Router Catalog — 已通过稳定 Remote MCP Surface 暴露：** machine-local 的下游 MCP 配置可以显式将某个 Provider 及选定 Tool 纳入 Router Catalog。`chatcockpit.capabilities.list` 只投影 public-safe 的 Provider/Tool 摘要；`chatcockpit.capabilities.inspect` 才返回成功 Probe 时已经保存的 bounded Tool Catalog Schema/Annotation 元数据。Provider-native Tool Name 永远只是返回数据，不会被动态注册成 ChatGPT Tool，因此 Resource Center 内容变化不会改变已批准的上游 Tool Snapshot。缺失、Protocol 已过期、尚未 Probe 或 Metadata 不完整的条目会保持明确状态，绝不会被隐式提升为 Ready。

**Capability Router Read Invocation — 已通过稳定 Remote MCP Surface 暴露：** `chatcockpit.capabilities.read.invoke` 只允许调用显式标记为 `read`、当前 Catalog 状态 Ready、bounded Input Schema 可用、参数通过官方 MCP SDK JSON Schema Validator，并且下游 Safety Annotation 不与只读分类冲突的 Provider-native Tool。调用前会重新检查当前 Router Exposure，并在同一条下游连接上执行 live `tools/list` attestation，要求当前 Input Schema / Safety Annotation 与已 Probe Snapshot 一致后才发送参数；Provider Result 只投影为有界 Text/Structured Output，非文本内容不会被隐式代理，Provider `isError` 与原始异常统一收敛到稳定 ChatCockpit Error Code。该上游 Tool Definition 保持静态，不随下游 Catalog 改变。

**Capability Router Governed Mutation — 已内部实现：** Provider-native `mutation` Tool 使用独立的 `prepare → operator decide → execute` 生命周期，并由 Core Governance Ledger 承载。Remote MCP 可以 Prepare，也可以在非 Remote-MCP Operator 已作出决定后 Execute，但不能审批自己的 Action。Approval 只绑定 local-device Target、Provider/Tool Identity、Canonical Arguments Hash、Executor Config Fingerprint 与已检查的 Policy Hash，不持久化原始参数。Execute 前会重新检查当前 Catalog、bounded Schema、Safety Annotation、Exposure Mode、Arguments Hash、Executor Config Fingerprint 与 Policy Hash，然后才 Consume Approval。完成态 Execution 仅允许在相同 Idempotency Key / Input 下安全 Replay；Provider 调用出现模糊失败时保持 Pending，必须显式恢复，禁止自动换 Key 重放。Provider Failure 只记录为有界 Execution Status/Error Code，原始 Provider Result 正文不会写入 Governance Tables。当前 Mutation Seam 仍是内部能力，尚未通过 Remote MCP 或 REST 暴露。

**Durable Host Managed Workspace Process — 已实现：** ChatCockpit 继续通过公共 `host_process_*` 身份管理受控 Workspace 交互进程，但真实 Desktop Commander stdio/PID namespace 已迁移到独立本机 Process Supervisor sidecar。Start 与 Input 必须由 owning chat-direct Session + Writer Lease 发起；Read/List 只返回有界 public-safe 状态/输出；Stop 保留用于安全清理。普通 Control Plane restart 只有在同一个 sidecar generation 仍拥有完全一致的 ChatCockpit Process / Workspace / Task / Session / Lease identity 时才允许重连。Sidecar 会通过 read-only SQLite 独立检查 Lease/Session/Workspace authority，把离线期间的 terminal event 记入本地 journal，待 Control Plane 恢复后幂等回流 Audit/Evidence；Downstream MCP 外层还有 process-group guardian，因此真实 hard-kill sidecar 后 managed child 不能继续产生延迟副作用。Schema v13 允许 sidecar-owned `running` 记录保持 `private_pid = NULL`；persisted PID 从来不是恢复凭据，新 Supervisor generation 也不会根据旧 PID 重连。系统级任意进程 attach/list/kill 继续明确不开放。ChatCockpit Built-in 与经过验证的 App Server Standalone 会被标准化为统一 Capability Descriptor，并提供 Health / Scope、public-safe discovery 与 `automatic | explicit` Provider Selection。ChatGPT 对外仍只连接 ChatCockpit Remote MCP。Downstream MCP 层也已实现：local-only Executor 配置通过官方 `@modelcontextprotocol/client` Transport/Client 生命周期驱动 stdio Probe，以显式 Tool → Capability Mapping 生成本地 Capability Snapshot，再投影 `downstream-mcp` Descriptor 并执行 normalized capability。ChatCockpit 继续负责 Policy、stderr/buffer 上限、public-safe Error Normalization、Snapshot 与 Capability Mapping；stdio Spawn、JSON-RPC Framing、Handshake、Request Correlation、Schema Validation 与 Transport Teardown 交由官方 SDK。新的 Downstream Probe 还会在本机持久化有界的 Tool Catalog，包括 input/output schema 与 annotations；旧 Snapshot 仍按 summary-only 元数据兼容读取，而且这份 Catalog 本身不会扩大公开 Remote MCP Tool Surface。Downstream Transport 当前通过官方 MCP Client SDK 同时支持本机 stdio 与 Streamable HTTP；明文 HTTP 仅允许 loopback，非 loopback Endpoint 必须使用 HTTPS，同时拒绝 URL 内嵌凭据与 fragment。Desktop Commander Managed Process 生命周期继续保持 stdio-only，因为它依赖本机进程 Ownership，而不是通用 MCP Transport 语义。当前 Desktop Commander Adapter Contract 已受治理地覆盖 Host `files.read`、`files.write`、`files.edit`，以及映射到当前 `start_process` 的 bounded `shell.exec`；`read_process_output`、`interact_with_process` 与 `force_terminate` 只作为 Adapter 私有生命周期依赖。Raw downstream tool name、raw shell source、raw downstream 进程控制、系统级任意 PID 操作和任意下游执行都不暴露；公共 Host 执行仍统一受 Scope、Approval、Workspace re-entry、Writer Lease、Git、Evidence/Audit、Idempotency、Timeout、Output Bound 与 Secret Safety 规则约束。

当前已实现的 Workspace Direct 由 Capability Broker 按以下 Provider 顺序解析 normalized capability：

1. 本机 Probe 已验证且标记为 Chat Direct 安全的 Codex App Server Standalone；
2. 其余能力或允许的自动回退由 ChatCockpit Built-in 承担。

显式指定 Executor 后不得静默切换到其他 Provider。已配置并成功 Probe 的 Downstream MCP Descriptor 可以向 Broker 声明经过映射的 Host Capability，但公共 Host Execution 仍单独受 allowlist 管理：当前 Remote MCP 授权受治理的 `files.read`、通过 Host Mutation 生命周期审批的 `files.write` / `files.edit`，以及只能通过 Host Command `prepare → decide → execute` 生命周期调用的 bounded `shell.exec`。Desktop Commander Process Tool 本身不是公共 Capability。

结果会记录 Lane、Model Loop Owner、Execution Scope、Executor、Selection Mode、Operation ID、Changed Paths 与 Evidence 关联。发布门禁证明 Chat Direct 不会隐式调用 `turn/start` 或创建 Codex Thread。

文件写入、文件编辑、Git Commit，以及所有被策略判定为可能写入的 Shell Command，都必须携带 Active `chat-direct` Session，并由该 Session 持有 Workspace Writer Lease；只读 Observer 保持免租约。

### Codex Session — 已实现，协议适配层为实验性

ChatCockpit `codex-session` 可以 Bind、Resume、Fork Codex App Server Thread。启动模型循环是单独的显式操作，并要求：

- Active Runtime Binding；
- Project / Workspace / Task / Session Revision 匹配；
- Workspace Writer Lease；
- Pre-run Handoff；
- Evidence Bundle；
- 固定 `on-request` User Approval Policy。

命令和文件变更 Approval 会持久化；原始 Server Request Handle 与 Private Request Body 保留在本机。

### Async Agent Job — 已实现的委托式后台执行通道

File-backed Queue / Runner 支持 Pack、TaskPack、Codex Run、Artifact 与可选隔离 Worktree。Async Agent Job 的本质是“委托后台执行”：Agent Runtime 持有模型循环，ChatCockpit 负责 Queue、Claim、Runtime Binding、生命周期、Artifact、Evidence、重启对账，以及执行结束后进入 Review 或 Blocked 的状态转换。

Async Job 已经是一等 Runtime Binding。Runner Job ID 作为 External Run Identity 持久化，而不是替代 ChatCockpit Task Identity；终态与 Restart Reconciliation 都按幂等合同处理。

## Continuity System of Record

SQLite 是持续状态真源。核心约束包括：

- 每个可写 Workspace 最多一个 Active Writer Lease；
- 每个 Session 最多一个 Active Codex Runtime Binding；
- 每个 Task 最多一个 Ready Handoff；
- Mutation 使用 Optimistic Revision；
- 外部 Mutation 使用 Pending/Completed Idempotency；
- Binding、Run、Approval、Event、Handoff 与 Evidence 保留历史，而不是原地覆盖。

ChatGPT Conversation、Codex Thread、Process ID 或 Runner Job 都不是 ChatCockpit Task 的唯一身份。

## Web UI

已实现：

- Dashboard
- Continuity Workbench
- Jobs
- Integrations（ChatGPT App / MCP 为主，API/OpenAPI 为高级能力，Custom GPT Actions 为兼容入口）
- Setup Wizard

Continuity 深链：

```text
<安全入口>/continuity/projects
<安全入口>/continuity/tasks
<安全入口>/continuity/sessions
<安全入口>/continuity/handoffs
<安全入口>/continuity/evidence
<安全入口>/continuity/approvals
```

全新初始化会随机生成 `<安全入口>`；原生 App 与 lifecycle status 会展示当前本机真实入口。

Workbench 读取真实 Workspace Snapshot，显示 Writer、Git、Task、Session、Handoff、Evidence 与 Approval，并支持 Prepare、Accept、Fork、Cancel。缺失 Evidence 不会显示为已验证。

## 安全边界

Public Client 只使用：

- Project / Workspace / Task / Session ID；
- Repo Alias；
- 相对 Public-safe Path；
- 有界输出与脱敏事件摘要；
- Public-safe Git、Handoff、Evidence、Approval 与 Artifact。

本机私有状态可以包含绝对路径、Codex Binary、原始 Approval Request、Runtime Log、配置和 Secret，但不会因为本地操作员可见就进入远程 Projection。

## 验证命令

```bash
npm run verify
npm run verify:protocol-core
npm run verify:source-archive
```

## 当前限制

- 公网 HTTPS 与不同 ChatGPT/MCP 客户端兼容性仍依赖环境并处于验证中；
- Downstream MCP 的 local config、stdio probe、snapshot、显式 mapping、Broker descriptor projection 与 normalized internal execution registry 已实现；
- Host Direct 已通过 public-safe Host Root Alias 开放受治理 Files 与 bounded Host Command。Pure Host Command 仍只读；Workspace write effect 必须经过 Direct Command Approval 与 Writer Lease/Git/Evidence 回流。Raw shell source、交互式终端和后台 Process Management 仍未开放；
- 目前的 Restart Gate 覆盖 Lease、Handoff 与 Idempotency，尚未自动恢复所有 Provider-specific Running Session；
- 未实现公共 SaaS 与分布式 Multi-runner Coordination。

## 相关文档

- [新手快速开始](../deployment/beginner-quickstart.md)
- [GPT Builder 配置指南](../deployment/gpt-builder-setup.md)
- [MCP 接入指南](../deployment/mcp-setup.md)
- [公网 HTTPS / 内网穿透](../deployment/public-https-tunnel.md)
- [Continuity Engine](../../architecture/continuity-engine.md)
