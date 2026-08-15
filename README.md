# ChatCockpit

简体中文 | [English](./README.en.md)

![ChatCockpit 项目海报](./docs/assets/chatcockpit-hero-zh-CN.webp)

**v0.2.0-alpha：ChatCockpit 原子产品切换预览。**

ChatCockpit 是一个以 ChatGPT 为入口的 **Development Continuity & Agent Routing Platform（AI 开发连续性与 Agent 能力路由平台）**。

**One repo. Multiple AI runtimes. Seamless handoff.**  一个项目，多种 AI 执行模式，无缝接力开发。

ChatGPT 负责对话、意图、规划与审查；ChatCockpit 提供本地优先控制面，统一管理 Project、Workspace、Task、Session、Writer Lease、Handoff、Evidence、Approval 与 Runtime Binding；Codex App Server 和本地 Runner 则分别承担显式 Codex Session 与异步 Agent Job 执行。

**省 Token，不省思考。谋定而后动，减少返工，有效开发。**

当前 alpha 已实现并可本地验证：CLI、Fastify Control Plane、REST/MCP/OpenAPI、Chat Direct 路由、Codex Thread Bind/Resume/Fork、显式 Turn/Approval/Interrupt、SQLite Continuity Store、版本化 Spec/Plan 真源与 REST/MCP 操作、Task 文档版本固定、显式 `planning-required | planning-optional` 执行策略、Writer Lease、结构化 Handoff、Evidence、Workspace Continuity Snapshot、证据约束的 Task Review/Completion、Continuity-bound Async Job Queue、Runner Claim/终态/重启对账、Runtime Recovery Center、60 个 MCP Tools，以及支持 Spec/Plan、Recovery、Handoff、Evidence 与真实规划/恢复阻塞项的 Continuity Workbench Web UI。

ChatCockpit 默认运行在你的本地开发环境中。连接 Custom GPT Actions 时，请使用你自己的受鉴权 HTTPS 地址；公开仓库只保留占位示例，不提交真实域名、Bearer token、隧道配置或机器路径。

## 它做什么

ChatGPT Native 是主要对话入口，不是一个需要逐级“升级”的 Runtime Lane。需要操作本机时，ChatCockpit 提供三种显式执行方式：

```mermaid
flowchart TB
    Chat["ChatGPT Native<br/>对话 · 推理 · 规划 · 审查"] --> MCP["ChatCockpit Remote MCP / Control Plane"]

    MCP --> Direct["Direct Drive<br/>ChatGPT 持有模型循环"]
    MCP --> Codex["Codex Session<br/>Codex 持有模型循环"]
    MCP --> Async["Async Agent Job<br/>后台 Agent 持有模型循环"]

    Direct --> Workspace["Workspace Direct<br/>已实现 · Project / Workspace"]
    Direct --> Host["Host Direct<br/>Files + bounded Command 已实现"]

    Workspace --> Broker["Capability Broker"]
    Host --> Broker
    Broker --> BuiltIn["ChatCockpit Built-in Executor"]
    Broker --> Standalone["Codex App Server Standalone"]
    Broker --> Downstream["Pluggable Downstream MCP Executor"]

    Codex --> AppServer["Codex App Server<br/>Thread · Turn · Approval"]
    Async --> Runner["Queue / Runner<br/>Isolated Worktree · Artifacts · Evidence"]

    Governance["Continuity & Governance<br/>Task · Session · Runtime Binding · Writer Lease · Handoff · Approval · Evidence"] -.-> Direct
    Governance -.-> Codex
    Governance -.-> Async
```

底层现有 `chat-direct` Runtime Lane 保持兼容；Direct Drive 是其产品级总称。Workspace / Host / isolated Worktree 描述“执行发生在哪里”，而 Direct Drive / Codex Session / Async Agent Job 描述“谁持有模型循环以及任务如何执行”。Direct Drive 已确认采用 **ChatCockpit Capability Broker + Pluggable Downstream MCP Executor** 架构。当前 Built-in / App Server Standalone 通过统一 capability contract 发现与选择，支持 `automatic | explicit` Provider Selection，并通过 `chatcockpit.direct.executors.list` 暴露 public-safe discovery。Downstream MCP 的 local-only 配置、stdio Probe、Capability Snapshot、显式 Tool Mapping、Broker Descriptor 与内部 Execution Registry 也已实现；Host Direct 现已通过 Host Root Alias 接入受治理的 `files.read`、需要短期 single-use Approval 的文本 `files.write` / Exact `files.edit`，以及同样经过 `prepare → decide → execute` 审批的 bounded Host Command。Pure Host Command 仅允许显式只读 policy；Workspace write-effect Command 自动回流 Session / Writer Lease / Git / Task Evidence。Raw shell source、交互式/后台 Process API 和下游 Process Tool 仍不对 Remote MCP 开放。

同一个 Task 可以通过 Writer Lease、Handoff Checkpoint 与 Evidence Bundle 在不同执行方式之间接力，而不是把某个 ChatGPT 对话、Codex Thread 或 Runner Job 当成唯一系统记录。

## 能力状态

### 已实现

- 本地 CLI、Fastify Control Plane、REST、MCP 与 OpenAPI。
- Direct Drive / Workspace Direct：底层继续使用 `chat-direct` Lane，提供文件读写、目录、内容搜索、受控 Shell、Git 与统一执行审计；Capability Broker 已统一 Built-in / App Server Standalone 的 capability discovery、健康状态与显式/自动 Provider Selection，并已证明不会隐式调用 `turn/start`。Downstream MCP 已具备 local config → probe → snapshot → descriptor → normalized execution 的完整链路，并已用于 Host Direct Files 与 bounded Host Command。
- Durable Host Managed Workspace Process：通过 ChatCockpit `host_process_*` 公共身份提供受审批的 Start / Input / Stop 与只读 Read / List；独立 Process Supervisor sidecar 持有 Desktop Commander runtime/PID namespace，使合法进程可跨普通 Control Plane restart 延续，同时继续由 Writer Lease watchdog、runtime generation/ownership、Audit/Evidence 和 process-group guardian 治理。Process Output 与 raw interactive input 不进入持久 Mutation 结果，PID 始终保持私有；系统级任意 PID attach/list/kill 不开放。
- Codex Session：Thread List/Read/Bind/Resume/Fork，以及显式 Turn、Interrupt、命令/文件审批和事件读取。
- Continuity Engine：SQLite Schema v19、Project、Workspace、Task、Session、通用 Runtime Binding、Runtime Recovery Attempt、append-only Runtime Resource Snapshot、append-only Spec/Plan 文档版本、Task 文档外键与不可变版本固定、显式 Task Execution Policy、Writer Lease、Handoff、Evidence、Runtime Approval、Direct Mutation Approval/Audit、Direct Command Approval/Audit、Direct Process Session/Approval/Audit、受治理 Runtime Resource Mutation Approval/Execution/Provenance、Process Supervisor Runtime Ownership 与 Runtime Event。
- Workspace Continuity Snapshot 与 Web UI：真实 Writer、Git、Specs & Plans、Tasks、Sessions、Runtime Recovery、Handoffs、Evidence、Approvals、Planning/Completion/Recovery Blockers、Runtime Binding 与 Runner Job；Recovery Center 由服务端 Assessment 驱动，支持显式 Codex Resume/Fork/Bind、Runner Reconcile、Chat Direct/Handoff 接续，不会自动启动 `turn/start` 或自动切换 Provider。
- Runtime & Resource Center：`/ui/resources` 统一展示 public-safe Runtime Profiles 与 append-only Inventory Snapshot，已接入 Native Codex Skills/MCP/Plugins/config 摘要、Downstream MCP Executor/Adapter 与 ACP Registry Agent Catalog；受治理 mutation 已开放到 Codex Skill enable/disable 与 Codex Plugin install/uninstall。Operator REST / Resource Center 支持 prepare → review/decide → execute；Remote MCP 只开放 prepare / inspect / execute，不能自行 decide，并且 exposed deployment 只有显式设置 `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true` 才注册这些 mutation tools。
- Async Agent Job：file-backed Queue、Runner、`createCodexRun`、Artifacts、可选 Worktree，以及 Task/Session/Binding 身份、Claim、终态 Evidence 和重启恢复对账。
- 默认 exposed-mode MCP catalog 为 62 个 tools，包含 Direct Drive Executor discovery、Host Root Alias discovery、Host Direct file read、`prepare → decide → execute` 的受审批 Host Write / Exact Edit、bounded Host Command、ChatCockpit-owned Managed Workspace Process、`chatcockpit.recovery.assess` / `chatcockpit.recovery.execute`，以及 `chatcockpit.resources.inventory` / `chatcockpit.resources.inspect`。本地非 exposed 模式或显式开启 Resource Mutation exposure 后，再注册 `chatcockpit.resources.mutation.prepare` / `inspect` / `execute` 3 个受约束工具（共 65 个），始终不注册 MCP `decide` / `reconcile`；同时提供 exposed-mode Bearer/OAuth 鉴权、public-safe 投影、历史隐私扫描与无 `.git` 源包门禁。

### 实验性

- 通过 Custom GPT Actions 或 Remote MCP 从 ChatGPT 访问本地 ChatCockpit。
- Codex App Server standalone 文件与命令执行；能力由本机 Probe 验证后才启用。
- Continuity Workbench 的交互式运行时治理。

### 验证中

- 不同 ChatGPT 客户端、网络代理和公网 HTTPS 入口的长期兼容性。
- 更多真实项目中的跨模式 Handoff 恢复与长时间运行行为。

## 操作员 Web UI

Web UI 是本地操作员控制台。除 Dashboard、Jobs、Setup Wizard 与 GPT Helper 外，Continuity Workbench 还提供 Projects、Specs & Plans、Tasks、Sessions、Recovery、Handoffs、Evidence、Approvals 八个稳定深链；独立 `/ui/resources` Resource Center 提供 Runtime Profile 选择、显式资源刷新、snapshot diff、Skills/MCP/Plugins/Adapters/ACP Agents 分类清单与详情检查，并对已获治理支持的 Codex Skill enable/disable 与 Codex Plugin install/uninstall 提供 prepare → review/decide → execute 工作流。Specs & Plans 可管理真实文档版本、哈希、生命周期、审批和 Task 绑定；Task 视图直接消费服务端 Planning Assessment，不在浏览器端推断执行资格。

![ChatCockpit GPT Helper 配置界面](./docs/assets/chatcockpit-gpt-helper-config.webp)

![ChatCockpit GPT Actions 写入文件实测](./docs/assets/chatcockpit-gpt-actions-writefile.webp)

在需要鉴权的模式下，浏览器会话提供 bearer token 前，受保护数据不会展示。

## 快速开始

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor
```

完整新手路径见 [`docs/zh-CN/deployment/beginner-quickstart.md`](./docs/zh-CN/deployment/beginner-quickstart.md)。

macOS Desktop 提供 **Self-contained Packaged Mode**：从源码构建出的 `ChatCockpit.app` 内含固定版本的 Node `24.18.1` 与 production runtime payload；App 运行时不要求系统 Node/npm，也不要求继续保留 ChatCockpit source checkout，只需要选择真正要操作的项目 Workspace。Phase 3 的 secretless distribution engineering 现已支持 arm64/x64 development DMG、trust-aware release manifest，以及显式 **Check for Updates → Download Update** 的 Manual Verified Update v1；development 产物始终保持 `releaseEligible=false`。当前项目尚未完成 Developer ID / Apple notarization 认证，因此不能把这些 development DMG 描述成正式 macOS 发行版。桌面边界见 [`docs/zh-CN/deployment/macos-desktop.md`](./docs/zh-CN/deployment/macos-desktop.md)，分发与认证边界见 [`docs/zh-CN/deployment/macos-release.md`](./docs/zh-CN/deployment/macos-release.md)。

macOS Developer / Source Mode 也可以直接启动本地 control plane 和 paired runner：

```bash
npm run mvp:start
npm run mvp:status
npm run doctor:runtime
```

打开本地控制台：

```text
http://127.0.0.1:4318/ui
```

可重复的本地配置放在 `~/.chatcockpit/runtime/server.env`：

```bash
CHATCOCKPIT_API_TOKEN=replace-with-your-builder-token
CHATCOCKPIT_EXPOSED=false
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
```

只有在你已经配置好 HTTPS 和访问凭据时，才使用 `CHATCOCKPIT_EXPOSED=true`。

## Custom GPT Actions 状态

公开 OpenAPI 合约位于 [`openapi/chatcockpit.openapi.yaml`](./openapi/chatcockpit.openapi.yaml)。其中的 `https://chatcockpit.example.com` 是占位域名；实际使用时请替换为你自己的 HTTPS 地址，不要把真实域名或 bearer token 提交到 Git。

Custom GPT Actions / Remote MCP 接入属于实验性部署面，但本地 REST/MCP 应用服务、鉴权、结构化错误、幂等和协议门禁已经实现。Direct Drive 适合由 ChatGPT 保持模型循环的确定性本机操作；当前已实现 Workspace Direct，以及受 Host Root Alias / 路径策略约束的 Host Direct Files 与 bounded Host Command。文本 Write / Exact Edit 使用 Direct Mutation Approval；Host Command 使用独立 Direct Command Approval，Pure Host 仅允许显式只读命令，Workspace write-effect Command 自动回流 Writer Lease / Git / Task Evidence。Raw shell、交互式终端和后台 Process Management 尚未开放。显式 Codex Session 适合需要 Codex Thread、Turn 与 Approval 的交互式 Agent 工作；更长或适合隔离执行的任务可通过 `createCodexRun` 进入 Async Agent Job。

`runShell` 不是 raw shell，Standalone `command/exec` 也不会绕过 ChatCockpit 的命令白名单、工作区 allowlist、exposed-mode 高信任开关、超时与输出上限。公网或隧道访问必须启用 Bearer Auth。

创建 Custom GPT、导入 Actions schema、配置鉴权和绑定公网 HTTPS 地址的完整步骤见：

- [`docs/zh-CN/deployment/gpt-builder-setup.md`](./docs/zh-CN/deployment/gpt-builder-setup.md)
- [`docs/zh-CN/deployment/public-https-tunnel.md`](./docs/zh-CN/deployment/public-https-tunnel.md)

## Codex Task Pack 最小模板

把下面结构交给 ChatGPT，再让它为 Codex 生成明确任务包：

````md
# Codex Task Pack

## 1. 目标

用一句话说明要解决的问题。

## 2. 上下文

只保留当前任务必要背景。

## 3. 范围

必须检查：
- path/to/file-a
- path/to/directory-b

必要时可以检查：
- path/to/related-module

禁止修改：
- path/to/unrelated-module
- package manager config
- global theme tokens

## 4. 执行要求

1. 先确认真实根因。
2. 做最小可验证改动。
3. 不引入无关依赖。
4. 保持现有风格。

## 5. 验证

```bash
npm run lint
npm run build
npm run test
```

## 6. 验收标准

- 原问题消失。
- 验证命令通过。
- diff 没有超出范围。
- 既有行为没有被破坏。
````

## 公开文档

- 新手快速开始：[`docs/zh-CN/deployment/beginner-quickstart.md`](./docs/zh-CN/deployment/beginner-quickstart.md)
- GPT Builder 配置：[`docs/zh-CN/deployment/gpt-builder-setup.md`](./docs/zh-CN/deployment/gpt-builder-setup.md)
- MCP 接入：[`docs/zh-CN/deployment/mcp-setup.md`](./docs/zh-CN/deployment/mcp-setup.md)
- 公网 HTTPS / 内网穿透：[`docs/zh-CN/deployment/public-https-tunnel.md`](./docs/zh-CN/deployment/public-https-tunnel.md)
- 本地运行参考：[`docs/zh-CN/deployment/local-runtime-ops.md`](./docs/zh-CN/deployment/local-runtime-ops.md)
- 架构说明：[`docs/zh-CN/architecture/local-first-control-plane.md`](./docs/zh-CN/architecture/local-first-control-plane.md)
- Continuity Engine：[`docs/zh-CN/architecture/continuity-engine.md`](./docs/zh-CN/architecture/continuity-engine.md)
- Chat Direct / Codex Session ADR：[`docs/zh-CN/architecture/adr-001-chat-direct-and-codex-session-lanes.md`](./docs/zh-CN/architecture/adr-001-chat-direct-and-codex-session-lanes.md)
- GPT Actions runner loop：[`docs/zh-CN/architecture/gpt-actions-runner-loop.md`](./docs/zh-CN/architecture/gpt-actions-runner-loop.md)
- Files Read API：[`docs/zh-CN/engineering/files-read-api.md`](./docs/zh-CN/engineering/files-read-api.md)
- 产品原则：[`docs/zh-CN/governance/product-principles.md`](./docs/zh-CN/governance/product-principles.md)
- 公共 / 私有产物治理：[`docs/zh-CN/governance/public-vs-private-artifacts.md`](./docs/zh-CN/governance/public-vs-private-artifacts.md)
- RTK 工程说明：[`docs/zh-CN/engineering/rtk.md`](./docs/zh-CN/engineering/rtk.md)

真实域名、反向代理、tunnel、Bearer token 和 GPT Builder 操作记录属于本地配置，不应提交到 Git。

## 当前能力状态

- [x] 本地 CLI、pack、manifest、taskpack
- [x] 本地 control plane、runner 与异步 job queue
- [x] OpenAPI、REST/MCP Parity 与 exposed-mode 鉴权
- [x] Chat Direct 文件、搜索、受控命令、Git 与 No-Turn 门禁
- [x] Codex App Server Thread Bind/Resume/Fork 与显式 Turn/Approval/Interrupt
- [x] SQLite Continuity Engine、Writer Lease、Handoff、Evidence 与 Runtime Event
- [x] Continuity Workbench 与真实 Workspace Snapshot
- [x] Schema v7 版本化 Spec/Plan、Task 版本固定与 planning-required/planning-optional 门禁
- [x] OAuth 持久化、恢复、撤销与公共错误边界
- [x] 无 Git 源码包、隐私、路径安全与发布验证门禁
- [x] First-run Setup Wizard、首任务模板与新手文档

未发布的产品分支不再作为内部路线图直接写入 README；对外计划以公开 Issues、Discussions 和 Release 记录为准。

## 安全与隐私

ChatCockpit 明确区分公开产品代码和私有 operator 事实。

不要提交：

- API keys、bearer tokens、cookies、local session files。
- 真实部署域名、tunnel tokens、private IP、internal hostnames。
- 个人绝对路径或机器相关运行态。
- `.codex/`、全局 `~/.chatcockpit/runtime/`、兼容期历史 `.tokenpilot/runtime/`、`.servbay/`、生成调试记录或私有规划材料。

提交前至少运行：

```bash
npm run verify:knowledge-boundary
npm run verify:web:safety
npm run privacy:scan:history
```

`npm run privacy:scan:history` 是只读扫描。历史泄露需要经过审查的 history rewrite 和协调后的 force-push；普通清理提交只能保护未来快照。

## 讨论

ChatCockpit 是一个实验性开源的 AI 开发连续性与 Agent 能力路由平台，面向 ChatGPT Native、Chat Direct、Codex Session、Async Agent Job 之间的可审计接力，以及 Token-conscious Planner / Coder / Reviewer 工作流。

- GitHub Discussions: <https://github.com/wuaishare/TokenPilot/discussions>
- GitHub Issues: <https://github.com/wuaishare/TokenPilot/issues>
- Pull Requests: 欢迎提交模板、文档、示例和工具改进。

## 免责声明

ChatCockpit 与 OpenAI、ChatGPT、Codex 或 GitHub 没有关联。它不会绕过任何平台限制，只是用更清晰的任务边界、更少的重复上下文、更安全的本地执行和更好的复盘审查，把现有工具串成可控工作流。

## 参考

- OpenAI Codex Web: <https://developers.openai.com/codex/cloud>
- OpenAI Codex Models: <https://developers.openai.com/codex/models>

## 许可证

[MIT License](./LICENSE)
