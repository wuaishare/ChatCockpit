# TokenPilot

简体中文 | [English](./README.en.md)

![TokenPilot 项目海报](./docs/assets/tokenpilot-hero-zh-CN.webp)

**v0.1.0-alpha：本地优先公开预览。**

TokenPilot 是一个以 ChatGPT 为入口的 **Development Continuity & Agent Routing Platform（AI 开发连续性与 Agent 能力路由平台）**。

**One repo. Multiple AI runtimes. Seamless handoff.**  一个项目，多种 AI 执行模式，无缝接力开发。

ChatGPT 负责对话、意图、规划与审查；TokenPilot 提供本地优先控制面，统一管理 Project、Workspace、Task、Session、Writer Lease、Handoff、Evidence、Approval 与 Runtime Binding；Codex App Server 和本地 Runner 则分别承担显式 Codex Session 与异步 Agent Job 执行。

**省 Token，不省思考。谋定而后动，减少返工，有效开发。**

当前 alpha 已实现并可本地验证：CLI、Fastify Control Plane、REST/MCP/OpenAPI、Chat Direct 路由、Codex Thread Bind/Resume/Fork、显式 Turn/Approval/Interrupt、SQLite Continuity Store、版本化 Spec/Plan 真源与 REST/MCP 操作、Task 文档版本固定、显式 `planning-required | planning-optional` 执行策略、Writer Lease、结构化 Handoff、Evidence、Workspace Continuity Snapshot、证据约束的 Task Review/Completion、Continuity-bound Async Job Queue、Runner Claim/终态/重启对账、44 个 MCP Tools，以及支持 Spec/Plan 创建、版本、审批、绑定与真实规划阻塞项的 Continuity Workbench Web UI。

TokenPilot 默认运行在你的本地开发环境中。连接 Custom GPT Actions 时，请使用你自己的受鉴权 HTTPS 地址；公开仓库只保留占位示例，不提交真实域名、Bearer token、隧道配置或机器路径。

## 它做什么

```text
ChatGPT Native：对话、推理、规划与审查
Chat Direct：ChatGPT 拥有模型循环，TokenPilot / App Server 只执行工具
Codex Session：Codex 拥有显式模型循环，支持 Thread Bind/Resume/Fork 与审批
Async Agent Job：Queue/Runner 执行长任务、产出 Diff、Artifacts 与 Evidence
```

TokenPilot 的能力升级路径：

```text
ChatGPT Native -> Chat Direct -> Codex Session -> Async Agent Job
```

同一个 Task 可以通过 Writer Lease、Handoff Checkpoint 与 Evidence Bundle 在不同运行模式之间接力，而不是把某个 ChatGPT 对话、Codex Thread 或 Runner Job 当成唯一系统记录。

## 能力状态

### 已实现

- 本地 CLI、Fastify Control Plane、REST、MCP 与 OpenAPI。
- Chat Direct：文件读写、目录、内容搜索、受控 Shell、Git 与统一执行审计；已证明不会隐式调用 `turn/start`。
- Codex Session：Thread List/Read/Bind/Resume/Fork，以及显式 Turn、Interrupt、命令/文件审批和事件读取。
- Continuity Engine：SQLite Schema v7、Project、Workspace、Task、Session、通用 Runtime Binding、append-only Spec/Plan 文档版本、Task 文档外键与不可变版本固定、显式 Task Execution Policy、Writer Lease、Handoff、Evidence、Approval 与 Runtime Event。
- Workspace Continuity Snapshot 与 Web UI：真实 Writer、Git、Specs & Plans、Tasks、Sessions、Handoffs、Evidence、Approvals、Planning/Completion Blockers、Runtime Binding 与 Runner Job；支持文档创建/版本/Ready/Approve/绑定，以及 Prepare、Accept、Fork、Cancel、Submit Review 和 Complete Task。
- Async Agent Job：file-backed Queue、Runner、`createCodexRun`、Artifacts、可选 Worktree，以及 Task/Session/Binding 身份、Claim、终态 Evidence 和重启恢复对账。
- 44 个 MCP Tools，包含 Spec/Plan 创建、读取、历史版本、追加版本、状态流转和 Task 绑定；同时提供 exposed-mode Bearer Auth、public-safe 投影、历史隐私扫描与无 `.git` 源包门禁。

### 实验性

- 通过 Custom GPT Actions 或 Remote MCP 从 ChatGPT 访问本地 TokenPilot。
- Codex App Server standalone 文件与命令执行；能力由本机 Probe 验证后才启用。
- Continuity Workbench 的交互式运行时治理。

### 验证中

- 不同 ChatGPT 客户端、网络代理和公网 HTTPS 入口的长期兼容性。
- 更多真实项目中的跨模式 Handoff 恢复与长时间运行行为。

### 目标方向

- Provider Adapter Layer 与更多外部 Coding Agent。
- Skills、MCP、Rules、Prompt、Agent、Hook、Plugin 等 Resource Center 能力。
- 在现有 Spec/Plan First 基础上扩展 TDD/SDD/BDD 编排、模板与多设备控制面。

## 操作员 Web UI

Web UI 是本地操作员控制台。除 Dashboard、Jobs、Setup Wizard 与 GPT Helper 外，Continuity Workbench 还提供 Projects、Specs & Plans、Tasks、Sessions、Handoffs、Evidence、Approvals 七个稳定深链。Specs & Plans 可管理真实文档版本、哈希、生命周期、审批和 Task 绑定；Task 视图直接消费服务端 Planning Assessment，不在浏览器端推断执行资格。

![TokenPilot GPT Helper 配置界面](./docs/assets/tokenpilot-gpt-helper-config.webp)

![TokenPilot GPT Actions 写入文件实测](./docs/assets/tokenpilot-gpt-actions-writefile.webp)

在需要鉴权的模式下，浏览器会话提供 bearer token 前，受保护数据不会展示。

## 快速开始

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor
```

完整新手路径见 [`docs/zh-CN/deployment/beginner-quickstart.md`](./docs/zh-CN/deployment/beginner-quickstart.md)。

macOS 上也可以直接启动本地 control plane 和 paired runner：

```bash
npm run mvp:start
npm run mvp:status
npm run doctor:runtime
```

打开本地控制台：

```text
http://127.0.0.1:4318/ui
```

可重复的本地配置放在 `.tokenpilot/runtime/server.env`：

```bash
TOKENPILOT_API_TOKEN=replace-with-your-builder-token
TOKENPILOT_EXPOSED=false
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
```

只有在你已经配置好 HTTPS 和访问凭据时，才使用 `TOKENPILOT_EXPOSED=true`。

## Custom GPT Actions 状态

公开 OpenAPI 合约位于 [`openapi/tokenpilot.openapi.yaml`](./openapi/tokenpilot.openapi.yaml)。其中的 `https://tokenpilot.example.com` 是占位域名；实际使用时请替换为你自己的 HTTPS 地址，不要把真实域名或 bearer token 提交到 Git。

Custom GPT Actions / Remote MCP 接入属于实验性部署面，但本地 REST/MCP 应用服务、鉴权、结构化错误、幂等和协议门禁已经实现。Chat Direct 适合由 ChatGPT 保持模型循环的文件、搜索、受控命令与 Git 操作；显式 Codex Session 适合需要 Codex Thread、Turn 与 Approval 的工作；更长任务仍可通过 `createCodexRun` 进入异步 Runner。

`runShell` 不是 raw shell，Standalone `command/exec` 也不会绕过 TokenPilot 的命令白名单、工作区 allowlist、exposed-mode 高信任开关、超时与输出上限。公网或隧道访问必须启用 Bearer Auth。

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
- 公共 / 私有产物治理：[`docs/zh-CN/governance/public-vs-private-artifacts.md`](./docs/zh-CN/governance/public-vs-private-artifacts.md)
- RTK 工程说明：[`docs/zh-CN/engineering/rtk.md`](./docs/zh-CN/engineering/rtk.md)

真实域名、反向代理、tunnel、Bearer token 和 GPT Builder 操作记录属于本地配置，不应提交到 Git。

## 路线图

- [x] 本地 CLI、pack、manifest、taskpack
- [x] file-backed job queue
- [x] 本地 control plane 和 runner
- [x] OpenAPI 草案与 exposed-mode bearer auth
- [x] 本地 E2E 验证
- [x] 本地操作员 Web UI MVP
- [x] `createCodexRun` jobs 与 public-safe artifacts
- [x] Chat Direct 文件、搜索、受控命令、Git 与 No-Turn 门禁
- [x] Codex App Server Thread Bind/Resume/Fork 与显式 Turn/Approval/Interrupt
- [x] SQLite Continuity Engine、Writer Lease、Handoff、Evidence 与 Runtime Event
- [x] Continuity Workbench 与 Workspace Snapshot
- [x] REST/MCP Parity、44 个 MCP Tools、证据约束的 Task Review/Completion、Continuity-bound Async Job Queue、Runner 生命周期/重启对账、Completion/Runtime Web UX 与无 Git 源包门禁
- [x] Schema v7 版本化 Spec/Plan 真源、REST/MCP/Web 工作流、Task 文档版本固定与显式 planning-required/planning-optional 执行门禁
- [x] 首任务模板库与新手案例
- [x] First-run setup wizard
- [x] 中文 GPT Builder / 公网 HTTPS 配置文档
- [ ] Token Optimization Log 示例
- [ ] HTTPS / Custom GPT Actions 全流程真实验证
- [ ] Provider adapter layer
- [ ] Resource Center 与 TDD/SDD/BDD 编排扩展
- [ ] 繁體中文 README

## 安全与隐私

TokenPilot 明确区分公开产品代码和私有 operator 事实。

不要提交：

- API keys、bearer tokens、cookies、local session files。
- 真实部署域名、tunnel tokens、private IP、internal hostnames。
- 个人绝对路径或机器相关运行态。
- `.codex/`、`.tokenpilot/runtime/`、`.servbay/`、生成调试记录或私有规划材料。

提交前至少运行：

```bash
npm run verify:web:safety
npm run privacy:scan:history
```

`npm run privacy:scan:history` 是只读扫描。历史泄露需要经过审查的 history rewrite 和协调后的 force-push；普通清理提交只能保护未来快照。

## 讨论

TokenPilot 是一个实验性开源的 AI 开发连续性与 Agent 能力路由平台，面向 ChatGPT Native、Chat Direct、Codex Session、Async Agent Job 之间的可审计接力，以及 Token-conscious Planner / Coder / Reviewer 工作流。

- GitHub Discussions: <https://github.com/wuaishare/TokenPilot/discussions>
- GitHub Issues: <https://github.com/wuaishare/TokenPilot/issues>
- Pull Requests: 欢迎提交模板、文档、示例和工具改进。

## 免责声明

TokenPilot 与 OpenAI、ChatGPT、Codex 或 GitHub 没有关联。它不会绕过任何平台限制，只是用更清晰的任务边界、更少的重复上下文、更安全的本地执行和更好的复盘审查，把现有工具串成可控工作流。

## 参考

- OpenAI Codex Web: <https://developers.openai.com/codex/cloud>
- OpenAI Codex Models: <https://developers.openai.com/codex/models>

## 许可证

[MIT License](./LICENSE)
