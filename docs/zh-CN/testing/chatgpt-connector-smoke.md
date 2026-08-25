# ChatGPT Connector Smoke Test

本文用于验证一个已经连接并完成 OAuth 授权的 **ChatCockpit custom MCP app** 是否真的可以从 ChatGPT 中稳定调用，而不是只验证 OAuth 页面“连接成功”。

> ChatGPT 的 Apps / Developer Mode UI 与权限可能随产品更新变化。以 OpenAI 当前官方文档为准：<https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>

## 前置条件

- ChatCockpit Control Plane 正常运行；
- 公网 MCP endpoint 可达；
- ChatGPT 中 ChatCockpit App 已连接并完成 OAuth；
- OAuth authority 已获得可刷新的访问权限；
- 使用新的 ChatGPT 对话执行测试，避免旧对话残留工具状态影响判断。

在 ChatGPT 中，可以从工具菜单选择 ChatCockpit，也可以在提示词中明确要求使用 ChatCockpit。

### P0.2 工具面说明

canonical `/mcp` 现在只暴露 16 个普通开发 Core。`chatcockpit.tools.discover` 可以说明 8 个专业能力包及其 endpoint，但不会在当前 ChatGPT 连接中动态加入工具。需要 Continuity 治理、Codex Native、Host 管理、Runtime 管理等专业能力时，必须显式配置到相应 `/mcp/packs/<pack>`；`/mcp/full` 只用于完整兼容验证，不应作为新的默认 ChatGPT App。

## 1. Discovery / Read-only

先从不会产生写入的操作开始。

### Prompt A — 项目发现

```text
使用 ChatCockpit 列出当前已知的 Projects。
只读取，不要修改任何状态。
请告诉我你实际调用了哪些 ChatCockpit 工具。
```

典型工具：

```text
chatcockpit.project.list
chatcockpit.project.get
```

### Prompt B — 默认 Core 的能力发现与连续性

```text
使用 ChatCockpit 说明有哪些专业能力包；如果已知 primary Workspace ID，再生成它的 Continuity Capsule。
只读取，不要启动 Codex Turn，也不要修改项目状态。
```

典型 Core 工具：

```text
chatcockpit.tools.discover
chatcockpit.continuity.capsule
```

如果需要更深的 `chatcockpit.workspace.snapshot`，应显式连接 `continuity-governance` 能力包。

### Prompt C — Git + 文件读取

```text
使用 ChatCockpit 查看 primary Workspace 的 git status，
然后读取 package.json，告诉我项目名称、版本和 Node.js 最低版本。
不要修改文件。
```

典型工具：

```text
chatcockpit.git.status
chatcockpit.files.read
```

通过标准：

- ChatGPT 明确使用 ChatCockpit，而不是凭对话上下文猜测；
- 读取结果与当前真实 Workspace 一致；
- 没有出现 legacy product namespace 的 MCP tool；
- 没有产生意外写入。

## 2. Continuity Governance 专业能力包

本节开始前，显式连接 `/mcp/packs/continuity-governance`。使用独立的 disposable Task 测试跨对话连续性，不要拿真实生产 Task 做 smoke target。

### Prompt D — 创建测试 Task

```text
使用 ChatCockpit 创建一个 disposable Continuity Task：
标题为 “R5 Connector Smoke Test”。
目标是验证 ChatGPT custom MCP app 的跨对话连续性。
不要修改 Git 工作区文件。
创建后返回 Task ID 和当前状态。
```

典型工具：

```text
chatcockpit.task.create
chatcockpit.task.get
```

然后新开一个 ChatGPT 对话：

```text
使用 ChatCockpit 找到刚才的 “R5 Connector Smoke Test” Task，
读取它的当前状态并总结已有上下文。
不要修改它。
```

通过标准：

- 新对话不依赖旧聊天上下文也能从 ChatCockpit durable state 恢复 Task；
- Task identity 稳定；
- ChatGPT 对“聊天上下文”和“ChatCockpit 系统记录”的边界表达清楚。

## 3. Session / Evidence / Handoff

在 disposable Task 上继续测试：

```text
使用 ChatCockpit 为 R5 Connector Smoke Test 启动一个 Session，
并记录一条 Evidence：说明 read-only connector smoke 已通过。
不要修改项目文件。
```

典型工具：

```text
chatcockpit.session.start
chatcockpit.evidence.record
```

之后可以测试 Handoff：

```text
为这个 smoke Task 准备一个 Handoff checkpoint，
只记录当前已验证内容，不要触发新的执行任务。
```

典型工具：

```text
chatcockpit.handoff.prepare
```

## 4. Approval-gated mutation

不要为了测试写入而污染真实产品源码。

优先使用：

- 专门的 scratch Workspace；或
- 明确可丢弃的测试文件/测试 Task；或
- 不产生持久文件变化、但仍经过 ChatCockpit approval policy 的 bounded 操作。

测试时明确告诉 ChatGPT：

```text
使用 ChatCockpit 准备一个需要审批的 bounded 操作。
在执行前先向我说明：目标、影响范围、将调用的工具以及为什么需要审批。
未经我的明确确认不要执行。
```

通过标准：

- 操作范围在执行前可见；
- ChatGPT 不会绕过 ChatCockpit 的 Approval / Mutation policy；
- 拒绝审批时不产生写入；
- 批准后结果进入可审计状态；
- 不出现 raw unrestricted shell。

## 5. Codex Native 专业能力包

本节使用显式 `/mcp/packs/codex-native` 连接。只有在前面的 Direct / Continuity 测试稳定后，再测试 Codex 模型循环：

```text
使用 ChatCockpit 查看可用 Codex Threads。
不要启动新的 Turn，先只列出并说明可恢复的 Session。
```

典型工具：

```text
chatcockpit.codex.thread.list
chatcockpit.codex.thread.read
```

显式启动 Turn 时，应明确这是从 ChatGPT-held model loop 切换到 Codex-held model loop 的动作。

## 6. Workflow 专业能力包

本节使用 `/mcp/packs/workflow`，并继续遵守需要的 Continuity 身份与治理约束。


使用 disposable Task/Workspace 测试：

```text
使用 ChatCockpit 为一个只读检查创建 Async Agent Job。
先说明 job 范围和预期 artifacts，再排队执行。
```

典型工具：

```text
chatcockpit.asyncJob.queue
```

验证：

- Job 有明确 durable identity；
- Runner 能 claim 并进入终态；
- artifacts 可读；
- 结果不会只存在于当前聊天窗口。

## 7. OAuth reconnect / refresh

正常使用一段时间并重新打开 ChatGPT 对话后，再执行 Prompt A 或 Prompt C。

通过标准：

- 不需要频繁重新授权；
- refresh authority 能维持连接；
- revoked / expired authority 不会被错误当作 active；
- ChatCockpit 不接受 legacy MCP scope 作为新的 ChatCockpit authority。

## 8. Smoke Test 结束

对 disposable Task：

- 可以保留作为 R5 evidence；或
- 在证据记录完成后明确完成该 Task。

不要把测试遗留误当成真实产品工作。
