# TokenPilot MCP 接入指南

## 能力状态

- 本地 MCP HTTP 传输：已实现
- REST/MCP 共用 Application Service 与 Parity 测试：已实现
- Exposed Mode Bearer Auth：已实现
- 通过远程 ChatGPT 或其他 MCP 客户端使用：实验性，取决于客户端与网络环境
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

只要通过公网 HTTPS、Tunnel、局域网或非 Loopback 地址暴露，就必须配置：

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-token
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

客户端请求头：

```text
Authorization: Bearer <TOKENPILOT_API_TOKEN>
```

不要把真实 Token、域名、Tunnel 凭据或机器路径提交到 Git。

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

发布门禁会验证：鉴权、Tool List、Tool Call、结构化错误、幂等、`/mcp` 与 `/tokenpilot/mcp` 别名。

## 4. 工具分类

当前公开目录包含 44 个工具，覆盖：

- public-safe Files、Search、Shell、Git；
- Project、Workspace Snapshot、Task、Session、Writer Lease、Handoff、Evidence、Submit Review、受治理的 Completion 与 Continuity-bound Async Job Queue；
- Spec/Plan 创建、列表、读取、不可变历史版本读取、追加版本、生命周期与 Task 绑定；
- Codex Runtime Capability 与 Thread Metadata；
- Codex Session Bind、Resume、Fork；
- 显式 Codex Turn、Interrupt、Approval Response 与 Event Read。

客户端应读取实时 `tools/list`，不要把旧工具清单写死。

## 5. 明确选择运行模式

### Chat Direct

当 ChatGPT 或当前 MCP 客户端应继续拥有模型循环时，使用普通文件、搜索、命令与 Git 工具。

每个结果都会标记：

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
npm run verify:protocol-core
npm run verify:source-archive
```

第一条验证 MCP/REST、Continuity、Codex 与 Chat Direct 协议行为；第二条证明没有 `.git` 元数据的源码包也能安装、构建、启动并提供 Control Plane API。
