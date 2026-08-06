# ADR-001：分离 Chat Direct 与 Codex Session 通道

- 状态：已接受，并已覆盖当前 Chat Direct 与 Codex Session 的写入面
- 日期：2026-08-06

## 背景

TokenPilot 必须支持两种不同的本地开发方式：

1. 普通 ChatGPT / MCP Client 直接操作 Allowlisted Project；
2. ChatGPT 显式发现并委托一个 Codex Session。

两者可以复用 Codex App Server 能力，但 Model Loop Owner、用量、Approval、安全边界和操作员预期不同。低层工具不能因为“执行命令”就偷偷启动 Codex Turn。

## 决策

TokenPilot 使用一个 Codex App Server Adapter，但公开两个明确通道。

### Chat Direct

- Model Loop Owner：ChatGPT；
- 可以使用本机 Probe 验证过的 App Server Standalone，或 TokenPilot Direct Executor；
- 不得隐式调用 `turn/start`、`codex exec` 或等价 Agent Loop；
- 结果必须记录 Lane、Owner、Executor、Operation ID、Changed Paths 与 Evidence 关联；
- Unsupported Capability 返回稳定降级，而不是假装成功。

当前已验证 Standalone File/Command 方法不需要 Ephemeral Carrier Thread。未来若某项能力必须依赖 Thread-shaped Context，可以引入 Carrier，但它不能被呈现为用户原生 Codex Session，也不能启动 Codex Turn。

### Codex Session

- Model Loop Owner：Codex；
- 支持 Thread List/Read/Bind/Resume/Fork；
- Turn Start、Interrupt、Approval、Event 都是显式操作；
- Write-capable Turn 必须通过 Runtime Binding、Writer Lease、Pre-run Handoff、Evidence 与 Revision 检查；
- External Thread ID 是可替换 Runtime Binding，不是 TokenPilot Task 主键。

## Chat Direct 合同

可以执行：

- File Read/List/Write/Edit；
- Content Search；
- Policy-approved Command；
- Git Status/Diff/Commit；
- Verification 与 Evidence Recording。

必须：

- 保持 ChatGPT 是唯一 Model Loop；
- 返回结构化有界结果；
- 记录执行器与变更；
- 不把 Skipped Verification 报告成 Passed。

不得：

- 创建隐藏的 Persistent Codex Development Session；
- 启动或继续 Codex Turn；
- 静默切换 Provider / Billing Lane；
- 绕过 Workspace、Path、Command、Timeout、Output 与 Exposed-mode Policy。

当前实现：文件写入、文件编辑、Git Commit，以及所有被策略判定为可能写入的 Shell Command，都必须携带 Active `chat-direct` Session，并由该 Session 持有 Workspace Writer Lease。Files/Search/Git 只读操作和保守判定为只读的 Shell Command 不要求 Writer Ownership。Codex Turn 继续独立校验其绑定 Session 与 Writer Lease。

## Writer Lease

- 每个可写 Workspace 最多一个 Active Writer；
- Chat Direct 与 Codex Session 不应同时写同一 Checkout；
- Observer 可以在其他 Writer 存在时读取；
- Parallel Work 需要 Forked Session 与 Separate Worktree；
- Handoff 在安全 Checkpoint 后转移 Ownership。

## 能力协商

Adapter 启动或 Probe 时记录：

- Codex Binary Version；
- App Server Protocol Version；
- Supported Methods；
- Standalone Execution；
- Thread / Turn Lifecycle；
- Approval / Event；
- Degraded Behavior。

TokenPilot 不会因为旧版本曾存在某方法就默认当前可用。

## 已拒绝方案

### 所有本地工作都调用 Codex

会消灭独立 Chat Direct Lane，引入第二模型循环并破坏配额韧性。

### 只做低层文件和 Shell

无法复用专业 App Server Runtime，也会把 TokenPilot 降级成普通 MCP Server。

### 优先 Fork / Embed Codex Internal

在官方 Adapter 边界尚未验证前，会产生不必要的维护、兼容、License 与安全负担。

### 允许 ChatGPT 与 Codex 同时写同一 Workspace

会导致非确定性、文件冲突、过期 UI 与不可可信 Evidence。

## 实现状态

1. Chat Direct Edit/Command 不调用 Codex Turn 或 Thread：已实现并测试；
2. Codex Turn 不能通过 Chat Direct Tool 启动：已实现；
3. 两通道 Writer Ownership：已实现，所有写入面绑定 Session 与 Writer Lease，只读 Observer 保持免租约；
4. Handoff 记录 Project、Task、Git、Changed Files、Pending、Risks、Next Action 与 Evidence：已实现；
5. Capability Probe 与 Deterministic Fallback：已实现；
6. Ephemeral Carrier 与 Native Thread 分离：当前未创建 Carrier；未来实现时必须满足该约束。

英文 ADR 见 [`../../architecture/adr-001-chat-direct-and-codex-session-lanes.md`](../../architecture/adr-001-chat-direct-and-codex-session-lanes.md)。
