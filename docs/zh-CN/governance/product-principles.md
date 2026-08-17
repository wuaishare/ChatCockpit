# ChatCockpit 产品原则

ChatCockpit 是一个本地优先的 **AI 开发连续性与 Agent 能力路由平台（Development Continuity & Agent Routing Platform）**。

> **一个项目，多种 AI 执行模式，无缝接力开发。**

本文是公开、面向贡献者的产品合同。它只描述实现与公开文档必须长期保持的不变量，不公开维护者内部的决策演进、竞品研究、商业策略或执行计划。

## 产品责任

ChatCockpit 负责不同开发 Runtime 之间的连续性。工作可以在 ChatGPT Native、Chat Direct、Codex Session 和异步 Agent 执行之间迁移，但 Project 与 Task 身份保持稳定。

长期状态包括：

- Project 与 Workspace 身份
- 版本化 Spec 与 Plan
- Task 与 Session
- Runtime Binding
- Writer Lease
- Handoff Checkpoint
- Evidence 与验证状态
- Approval 与 Idempotency 状态

聊天历史可以提供上下文，但不能成为开发状态的唯一持久真源。

## 产品 Surface

ChatCockpit 会明确区分不同产品 Surface，而不是把 Menu Bar、原生 App 与 Web Cockpit 做成彼此的复制品：

- **Menu Bar：** 有明确边界的 Operational HUD，负责快速健康状态、活动摘要与安全高频本机操作；
- **macOS App：** Local Runtime Manager + Secure Machine Gateway，持有 Machine Authority；
- **Web Cockpit：** 数据密集型 Operator Workspace，持有 Operator Authority；
- **Runtime：** 所有 Surface 共用的唯一业务真源与执行层。

只读 Projection 可以跨越这些边界，但高权限 Mutation Authority 不能随之转移。能力归属、状态语义与 Bridge 规则以 [Surface 设计合同](../architecture/surface-design-contract.md) 为准。

## Runtime Ownership

模型循环的所有权必须始终显式。

- **Chat Direct：** ChatGPT 持有模型循环。ChatCockpit 可以使用确定性的本地执行器或已验证的 Standalone Runtime 能力，但不得隐式启动 Codex Turn。
- **Codex Session：** 只有通过显式 Session / Turn 操作时，Codex 才持有被委托的模型循环。
- **Async Agent Job：** 外部或本地 Agent Runtime 持有模型循环，ChatCockpit 显式记录其 Binding 与生命周期。

低层操作不得静默改变 Model Loop Owner、用量/计费通道、Approval 语义或 Runtime 身份。

## Continuity 不变量

1. 一个物理 Checkout 同时最多只有一个 Active Writer；并行写入必须使用独立 Worktree。
2. Runtime Session ID 是可替换 Binding，不是 ChatCockpit Task 身份。
3. Handoff 传递的是持久状态与 Evidence，而不是不透明的完整聊天记录。
4. Task 绑定的 Spec / Plan 版本必须显式，并对本次执行决策保持不可变。
5. 写入操作必须遵守 Revision、Idempotency、Writer Ownership 与 Evidence 约束。
6. 恢复流程必须优先使用高置信度 Repository / Workspace 身份，不允许靠猜测自动绑定。
7. 公开投影使用稳定 ID 与有界 Evidence，不把私有文件系统路径当成 API 合同。

## 安全与隐私边界

- Repository 与 Workspace 必须显式进入 Allowlist。
- 路径在解析符号链接后仍必须位于 Canonical Repository Root 内。
- Exposed Mode 必须显式鉴权，并对高信任命令使用更严格策略。
- 公开 HTTP、MCP、OpenAPI、Git、Runtime 与 Artifact 输出必须保持 public-safe。
- Secret、真实部署信息、机器运行态和维护者私有知识不进入公开仓库。

## Adapter 策略

当官方 Runtime 或协议已经提供成熟能力时，ChatCockpit 优先复用，而不是重新制造一套通用 Coding Agent Runtime。

- 官方上游规范定义协议真相。
- Runtime Adapter 隔离外部生命周期差异与 ChatCockpit Continuity State。
- REST、MCP、Web UI 共用 Application Services，不按 Transport 重写业务规则。
- Unsupported Capability 必须显式失败或安全降级，不能伪装成成功。

## 明确非目标

ChatCockpit 不以以下方向为目标：

- 再做一个通用 Coding Agent 或 IDE；
- Fork 或重写 Codex 模型 Runtime；
- 暴露任意匿名 Shell；
- 从 Chat Direct 隐式启动或继续 Codex 推理；
- 绕过平台用量、额度、计费或安全限制；
- 把私有部署运维、竞品研究、商业规划或内部执行计划变成 OSS 产品合同。

## 贡献者规则

公开文档应该说明：**当前产品保证什么，以及贡献者怎样保持这些保证。** 关于未来产品分支、商业选择、Reference Project 评估、否决路线和内部实施顺序的维护者推理，属于私有治理资料。
