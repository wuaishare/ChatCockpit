# TokenPilot 本地优先控制面架构

## 能力状态

- 已实现：CLI、Fastify Control Plane、REST/MCP/OpenAPI、Chat Direct、Codex Session Adapter、Continuity Engine、Queue/Runner 与 Web UI
- 实验性：Custom GPT Actions、Remote MCP、公网 HTTPS、Codex App Server Standalone
- 目标方向：更多 Provider Adapter、Resource Center、完整 Spec/Plan 与多设备连续性

TokenPilot 是一个本地优先的 **AI 开发连续性与 Agent 能力路由平台**。

```text
ChatGPT Native -> Chat Direct -> Codex Session -> Async Agent Job
```

ChatGPT 负责对话、意图、规划与审查；TokenPilot 负责持久身份、执行策略、连续性状态、Public-safe Projection 与跨运行模式 Handoff；不同 Runtime 只执行被明确选择的能力层。

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

### Chat Direct — 已实现

ChatGPT 保持模型循环。TokenPilot 按以下顺序执行单个工具操作：

1. 本机 Probe 已验证的 Codex App Server Standalone；
2. TokenPilot Direct Executor；
3. 明确保留的 Legacy Fallback。

结果会记录 Lane、Model Loop Owner、Executor、Operation ID、Changed Paths 与 Evidence 关联。发布门禁证明 Chat Direct 不会隐式调用 `turn/start` 或创建 Codex Thread。

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

### Async Agent Job — 已实现的旧执行通道

File-backed Queue / Runner 支持 Pack、TaskPack、Codex Run、Artifact 与可选 Worktree，并在 Continuity 迁移期间保持可用。

Async Job 尚未像 Codex Thread 一样进入统一 Runtime Binding 关系，这是后续扩展，不应误写成已完成。

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
- Spec/Plan 仍是目标 Domain，尚未完成完整 Store/Service/UI；
- Async Job 尚未统一为 Runtime Binding；
- 目前的 Restart Gate 覆盖 Lease、Handoff 与 Idempotency，尚未自动恢复所有 Provider-specific Running Session；
- 未实现公共 SaaS 与分布式 Multi-runner Coordination。

## 相关文档

- [新手快速开始](../deployment/beginner-quickstart.md)
- [GPT Builder 配置指南](../deployment/gpt-builder-setup.md)
- [MCP 接入指南](../deployment/mcp-setup.md)
- [公网 HTTPS / 内网穿透](../deployment/public-https-tunnel.md)
- [Continuity Engine](../../architecture/continuity-engine.md)
