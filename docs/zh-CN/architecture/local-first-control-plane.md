# TokenPilot 本地优先控制面架构

## 能力状态

- 已实现：CLI、Fastify Control Plane、REST/MCP/OpenAPI、Chat Direct、Codex Session Adapter、Continuity Engine、Queue/Runner 与 Web UI
- 实验性：Custom GPT Actions、Remote MCP、公网 HTTPS、Codex App Server Standalone
- 近期方向：Remote MCP 稳定性、Direct Drive 硬化、Codex Session 生命周期可靠性、Async Agent Job 可靠性，以及受治理的 Host Direct Scope

TokenPilot 是一个以 ChatGPT 为主要对话入口、本地优先的 **AI 开发连续性与 Agent 能力路由平台**。

ChatGPT Native 是入口与模型循环宿主，不再与本地执行模式排成一条线性“升级链”。当任务需要本机执行时，由 TokenPilot 进入三种显式执行模式之一：

```text
ChatGPT Native
  -> TokenPilot Remote MCP / Control Plane
       -> Direct Drive
            -> Workspace Direct（已实现）
            -> Host Direct Files（Read + 审批式 Write/Exact Edit 已实现；Shell 未开放）
       -> Codex Session
       -> Async Agent Job
```

ChatGPT 负责对话、意图、规划与审查。在 Direct Drive 中，ChatGPT 同时保持唯一模型循环，TokenPilot 只负责确定性执行；进入 Codex Session 后，模型循环被显式委托给 Codex；进入 Async Agent Job 后，由被委托的 Agent Runtime 在后台持有模型循环，而 TokenPilot 管理 Job 生命周期。TokenPilot 始终负责持久身份、执行策略、连续性状态、Public-safe Projection 与跨运行模式 Handoff。

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
- 协议、隐私、重启恢复和无 `.git` 源包门禁。

## 运行模式

### Direct Drive — Workspace Direct 与受治理 Host Files 已实现

Direct Drive 是“ChatGPT 保持唯一模型循环、TokenPilot 执行确定性本机操作”的产品级总称。为保持现有持久化合同兼容，底层 Runtime Lane 仍使用 `chat-direct`。

Direct Drive 分为两个执行 Scope：

- **Workspace Direct — 已实现：** 只在显式允许的 Project/Workspace 内操作，并继续使用现有 Path、Command、Git、Writer Lease、Evidence 与 Public-safe Projection 治理。
- **Host Direct Files — 已实现：** Remote MCP 可以通过本机配置的 Host Root Alias 读取小型 text-like 文件；当 Root 显式包含 `write` 时，还可以执行受审批的文本 Write / Exact Edit。ChatGPT 永远拿不到 Root 的本机绝对路径。TokenPilot 会执行相对路径校验、canonical containment、symlink escape 阻断、敏感路径阻断、文本类型与 64 KiB 上限、exact mutation hash 绑定、短期 single-use Direct Mutation Approval，以及写后内容校验。若 canonical target 命中已注册 Workspace，会自动回流到现有 chat-direct Session、Writer Lease、Git 与 Task Evidence 治理；真正的 Pure Host target 则使用 Direct Mutation Approval + public-safe Audit。Host Shell 继续未开放。

Direct Drive 已确认采用 **TokenPilot Capability Broker + Pluggable Downstream MCP Executor** 架构。TokenPilot Built-in 与经过验证的 App Server Standalone 会被标准化为统一 Capability Descriptor，并提供 Health / Scope、public-safe discovery 与 `automatic | explicit` Provider Selection。ChatGPT 对外仍只连接 TokenPilot Remote MCP。Downstream MCP 层也已实现：local-only Executor 配置驱动 stdio Probe，通过官方 MCP Schema 校验后，以显式 Tool → Capability Mapping 生成本地 Capability Snapshot，再投影 `downstream-mcp` Descriptor 并执行 normalized capability。当前通过 Desktop Commander Adapter Contract 已受治理地开放 Host `files.read`、`files.write`、`files.edit`；raw downstream tool name 与任意下游执行仍不暴露。Host Write / Exact Edit 必须继续经过 TokenPilot 自己的 Scope、Path Safety、Approval、Workspace re-entry、Writer Lease、Git、Evidence/Audit、Idempotency、Timeout、Output Bound 与 Secret Safety 规则；Host Shell 不属于本阶段。

当前已实现的 Workspace Direct 由 Capability Broker 按以下 Provider 顺序解析 normalized capability：

1. 本机 Probe 已验证且标记为 Chat Direct 安全的 Codex App Server Standalone；
2. 其余能力或允许的自动回退由 TokenPilot Built-in 承担。

显式指定 Executor 后不得静默切换到其他 Provider。已配置并成功 Probe 的 Downstream MCP Descriptor 可以向 Broker 声明经过映射的 Host Capability，但公共 Host Execution 仍单独受 allowlist 管理：当前 Remote MCP 只授权受治理的 `files.read`，以及通过 Host Mutation 生命周期进行审批的 `files.write` / `files.edit`。包括 `shell.exec` 在内的其他 Host Capability 仍只是 Discovery Evidence，不能通过 Remote MCP Host 执行面调用。

结果会记录 Lane、Model Loop Owner、Execution Scope、Executor、Selection Mode、Operation ID、Changed Paths 与 Evidence 关联。发布门禁证明 Chat Direct 不会隐式调用 `turn/start` 或创建 Codex Thread。

文件写入、文件编辑、Git Commit，以及所有被策略判定为可能写入的 Shell Command，都必须携带 Active `chat-direct` Session，并由该 Session 持有 Workspace Writer Lease；只读 Observer 保持免租约。

### Codex Session — 已实现，协议适配层为实验性

TokenPilot `codex-session` 可以 Bind、Resume、Fork Codex App Server Thread。启动模型循环是单独的显式操作，并要求：

- Active Runtime Binding；
- Project / Workspace / Task / Session Revision 匹配；
- Workspace Writer Lease；
- Pre-run Handoff；
- Evidence Bundle；
- 固定 `on-request` User Approval Policy。

命令和文件变更 Approval 会持久化；原始 Server Request Handle 与 Private Request Body 保留在本机。

### Async Agent Job — 已实现的委托式后台执行通道

File-backed Queue / Runner 支持 Pack、TaskPack、Codex Run、Artifact 与可选隔离 Worktree。Async Agent Job 的本质是“委托后台执行”：Agent Runtime 持有模型循环，TokenPilot 负责 Queue、Claim、Runtime Binding、生命周期、Artifact、Evidence、重启对账，以及执行结束后进入 Review 或 Blocked 的状态转换。

Async Job 已经是一等 Runtime Binding。Runner Job ID 作为 External Run Identity 持久化，而不是替代 TokenPilot Task Identity；终态与 Restart Reconciliation 都按幂等合同处理。

## Continuity System of Record

SQLite 是持续状态真源。核心约束包括：

- 每个可写 Workspace 最多一个 Active Writer Lease；
- 每个 Session 最多一个 Active Codex Runtime Binding；
- 每个 Task 最多一个 Ready Handoff；
- Mutation 使用 Optimistic Revision；
- 外部 Mutation 使用 Pending/Completed Idempotency；
- Binding、Run、Approval、Event、Handoff 与 Evidence 保留历史，而不是原地覆盖。

ChatGPT Conversation、Codex Thread、Process ID 或 Runner Job 都不是 TokenPilot Task 的唯一身份。

## Web UI

已实现：

- Dashboard
- Continuity Workbench
- Jobs
- GPT Helper
- Setup Wizard

Continuity 深链：

```text
/ui/continuity/projects
/ui/continuity/tasks
/ui/continuity/sessions
/ui/continuity/handoffs
/ui/continuity/evidence
/ui/continuity/approvals
```

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
- Host Direct Files 已通过 public-safe Host Root Alias 开放：`files.read` 保持只读，文本 Write / Exact Edit 必须同时满足 Root 显式 `write` 权限与 Direct Mutation Approval；Host Shell 仍未开放；
- 目前的 Restart Gate 覆盖 Lease、Handoff 与 Idempotency，尚未自动恢复所有 Provider-specific Running Session；
- 未实现公共 SaaS 与分布式 Multi-runner Coordination。

## 相关文档

- [新手快速开始](../deployment/beginner-quickstart.md)
- [GPT Builder 配置指南](../deployment/gpt-builder-setup.md)
- [MCP 接入指南](../deployment/mcp-setup.md)
- [公网 HTTPS / 内网穿透](../deployment/public-https-tunnel.md)
- [Continuity Engine](../../architecture/continuity-engine.md)
