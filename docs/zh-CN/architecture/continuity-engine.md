# TokenPilot Continuity Engine

## 状态

- 已实现基础：SQLite Schema v3、Project、Workspace、Task、Development Session、Codex Runtime Binding、Writer Lease、Handoff、Evidence、受证据约束的 Task Review/Completion、Runtime Run、Approval、Event、Workspace Snapshot、REST/MCP Parity 与 Continuity Workbench
- 实验性：Codex App Server 协议适配、Chat Direct Standalone 路由、通过 Custom GPT Actions 或 MCP 远程访问
- 目标扩展：完整 Spec/Plan Store、Async Job Runtime Binding、更丰富的 Task Transition、自动 Recovery Center 与更多 Provider Adapter

Continuity Engine 的目标是：当开发工作在 ChatGPT Native、Chat Direct、Codex Session、Async Agent Job、Branch、Worktree 或重启进程之间切换时，保持 Task 身份、Writer Ownership、Git 状态、Pending Work 与 Evidence 不丢失。

## 核心原则

1. 跨调用状态使用 TokenPilot ID，不把外部 Runtime ID 当主键；
2. 每个可写 Workspace 最多一个 Active Writer；
3. Handoff 必须显式记录 Goal、Completed、Pending、Changed Files、Risks 与 Next Action；
4. “已验证”只来自结构化 Evidence；
5. Runtime Binding 可替换并保留历史；
6. REST、MCP 与 Web UI 使用同一 Application Service；
7. 绝对路径、Secret 与 Private Runtime State 留在本机；
8. 每次执行明确记录 Lane 与 Model Loop Owner。

## 当前实体

```text
Project
  └── Workspace
        ├── Writer Lease
        ├── Git Snapshot
        └── Task
              ├── Development Session
              │     ├── Codex Runtime Binding
              │     ├── Runtime Run
              │     ├── Approval
              │     └── Runtime Event
              ├── Handoff Checkpoint
              └── Evidence Bundle
```

Spec 与 Plan 是目标 Domain，目前尚未完成完整持久化、Service 和 UI。

## Runtime Binding

当前实现专门绑定 Codex App Server Thread：

```ts
interface RuntimeBindingRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  runtimeKind: "codex-app-server";
  externalThreadId: string;
  sourceThreadId: string | null;
  relation: "bound" | "resumed" | "forked";
  status: "active" | "superseded" | "released" | "stale";
  modelProvider: string | null;
  revision: number;
}
```

Chat Direct 不伪装成 Codex Thread，而是在每个结果中记录：

```ts
{
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executor:
    | "codex-app-server-standalone"
    | "tokenpilot-direct"
    | "legacy-core";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
}
```

Async Job 统一 Runtime Binding 仍是目标扩展。

## Writer Lease

SQLite Partial Unique Index 保证每个 Workspace 只有一个 Active Lease。Codex Turn 强制要求 Writer Lease；Continuity Workbench 只允许 Lease Holder Session 准备 Handoff。

文件写入、文件编辑、Git Commit，以及所有被策略判定为可能写入的 Shell Command，都要求 Active `chat-direct` Session 持有 Workspace Writer Lease；只读 Files/Search/Git 与只读 Shell Observer 不要求租约。

## Handoff

当前 `prepare` 会：

- 校验 Task / Session / Workspace 关系；
- 拒绝同一 Task 的第二个 Ready Handoff；
- 若存在 Active Lease，则要求它属于 Source Session；
- 接收 Public-safe Git、Changed Files、Completed、Pending、Risks、Next Action 与可选 Evidence Bundle。

Ready Handoff 支持：

- Accept：标记 Accepted；
- Cancel：标记 Superseded；
- Fork：创建 Child Task 与 Target-mode Session，并消费原 Handoff。

Prepare/Fork/Cancel/Accept 都有 Revision 与 Idempotency 保护。重启门禁证明 Ready Handoff、Writer Lease 与 Idempotency Record 能跨新数据库连接恢复。

以下仍是硬化目标：

- 自动证明没有其他 Mutation 正在运行；
- 自动采集 Git，而非接受已审查的调用方 Projection；
- 每次 Handoff 都强制要求 Finalized Evidence；
- Prepare 时自动释放或转移 Lease。

## Evidence

Evidence Item 可以是 Command、Test、Build、Lint、Typecheck、Diff、Review、Screenshot 或 Manual。

Verification State 规则：

- `verified`：存在 Required Item、Bundle Complete、所有 Required Item Passed；
- `incomplete`：Evidence 存在但尚未满足全部 Required 条件；
- `missing`：没有 Required Evidence。

Skipped、Failed、Not-run 或缺失 Evidence 都不会显示为已验证。

## Task Review 与 Completion

公开状态机为：

```text
Session Start -> Task in-progress
Evidence Record -> Task Submit Review
Accepted Handoff + Released Writer -> Task Complete
```

`tokenpilot.task.submitReview` 会校验至少一个 Required Evidence，要求全部 Required Item Passed，Finalize Evidence Bundle，并把 `in-progress` 或 `blocked` Task 推进到 `review`。

`tokenpilot.task.complete` 只有在以下条件全部成立时才会完成 Task：

- Latest Handoff 属于该 Task 且已经 Accepted；
- Latest Evidence Bundle 属于该 Task Session、状态为 Complete，并与 Handoff 引用一致；
- Workspace 没有 Active Writer Lease；
- Task Sessions 没有 Active Runtime Run；
- 没有 Pending/Responded Approval；
- 没有 Ready Handoff。

完成事务会清除 `activeSessionId`、结束非终态 Session，并 Release/Clear Active Runtime Binding。完成后的 Task 不能重新启动 Session。REST 与 MCP 使用同一 Application Service，并支持同键幂等重放。

## Workspace Snapshot

```text
GET /api/continuity/workspaces/{workspaceId}/snapshot
tokenpilot.workspace.snapshot
```

返回 Public-safe：

- Project / Workspace；
- Active Writer Lease；
- Git Branch / HEAD / Dirty / Changed Paths；
- Tasks / Sessions；
- Latest Handoff；
- Evidence Checklist；
- Pending Approvals。

绝对路径与 Raw Runtime Request Body 不会返回。

## Web UI

已实现：

- Projects 与 Workspace Selector；
- Persistent Writer Banner；
- Git Summary；
- Tasks / Sessions；
- Handoff Prepare / Accept / Fork / Cancel；
- Evidence Checklist；
- Pending Approval List。

目标扩展：Runtime Binding Inspector、完整 Task Board/Timeline 与自动 Recovery Center。

## 里程碑状态

| 能力 | 状态 |
|---|---|
| Stable Project / Workspace ID | 已实现 |
| Chat Direct 与 Codex Session 连续性 | 已实现 |
| Async Job First-class Runtime Binding | 目标扩展 |
| One Writer Per Workspace | 已实现 |
| Handoff + Git + Pending Work | 已实现 |
| Structured Evidence | 已实现 |
| Evidence-governed Task Review / Completion | 已实现 |
| Lease/Handoff/Idempotency Restart Recovery | 已实现基础 |
| REST/MCP Parity | 已实现 |
| Writer/Handoff/Evidence Web UI | 已实现 |
| Replaceable Codex Runtime ID | 已实现 |
| Public-safe Projection | 已实现 |
| 所有 Running Session 自动恢复 | 目标扩展 |

英文完整实体契约见 [`../../architecture/continuity-engine.md`](../../architecture/continuity-engine.md)。
