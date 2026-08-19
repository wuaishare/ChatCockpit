# ChatCockpit 产品原则

ChatCockpit 是一个本地优先的 **AI 能力控制面板（AI capability control plane）**。

> **Chat is the interface. Cockpit is the control plane.**
> **聊天是入口，驾驶舱才是系统。**

本文是公开、面向贡献者的产品合同，只描述当前产品必须长期保持的不变量，不公开维护者内部的决策演进、竞品研究、商业策略或执行顺序。

## 产品责任

ChatCockpit 负责 AI 可访问能力之间的跨工具控制层：发现并标准化 Capability、暴露稳定产品接口、执行 Authority 与安全策略、记录有界 Evidence，并保持 local-first 真源边界。

Provider 可以是本机 Runtime、MCP Server、CLI、应用或其它经过审查的 Integration。Provider-native Tool Name 与 Provider-specific State 不能直接升级成公共产品接口，而必须位于 ChatCockpit 稳定 Capability 合同之下。

## 产品层级

```text
入口：ChatGPT / Desktop / Web / CLI / API
        -> ChatCockpit Control Plane
             -> Capability Router
             -> Resource Center
             -> Governance
             -> local-device
                  -> Providers / Adapters

Development Continuity = 建立在同一控制面之上的当前解决方案层
```

Development Continuity 仍然是重要且已实现的能力，但不再定义整个产品类别。

## Capability 不变量

1. Provider-native Tool Name 是 Catalog 数据，不动态注册成公共 ChatGPT Tool。
2. Provider 安装、删除、升级或 Catalog 漂移不能破坏稳定的 ChatCockpit Tool Surface。
3. 执行需要的 Provider Metadata 必须在副作用发生前重新验证。
4. 不支持或过期的 Capability 必须明确失败或安全降级，不能伪装成功。
5. 除非 ChatCockpit 明确拥有经过审查的 Managed Field，否则 Provider-native State 保持权威真源。

## Authority 与 Mutation

- Authentication 不等于 Mutation Authority。
- Remote MCP 不能自行批准重要的受治理变更。
- Provider-native mutation 在需要显式审批时使用 `prepare -> local operator decide -> execute`。
- Approval Binding、Idempotency、Actor Provenance 与有界 Evidence 是服务端合同，不依赖客户端确认 UI。
- Host 范围变大不能削弱治理：目标一旦落入受治理 Workspace，仍必须遵守 Path、Git、Writer Lease 与 Evidence 规则。

## Local-first 与 Public-safe

- 机器真实路径、凭据、Transport Config、Provider Raw Error、PID 与私有运行态默认留在本机，除非有专门 public-safe projection。
- 公共 HTTP、MCP、OpenAPI、Git、Runtime 与 Artifact 输出必须有界并脱敏。
- `local-device` 是稳定 Target Projection，不代表已经承诺 Multi-device Fleet 基础设施。
- Secret、私有部署真相、维护者 Intelligence 与商业规划不进入公开仓库。

## Adapter 策略

优先复用成熟 Provider 与官方协议，而不是复制它们已有的能力。

- 官方上游定义协议真相。
- Adapter 隔离 Provider 生命周期与 Transport 差异。
- REST、MCP、Web UI 共用 Application Services，不按 Surface 重写 Policy。
- ChatCockpit 应拥有跨 Provider Routing、Governance、Lifecycle Visibility、Evidence 与 Operator Experience，而不是再造通用 Runtime、Package Manager、Process Manager 或 IDE。

## Development Continuity 不变量

当前 Development solution layer 继续保证：

- Project / Workspace / Task 身份；
- 版本化 Spec / Plan Binding；
- Session 与 Runtime Binding；
- Writer Lease；
- Handoff 与 Evidence；
- Recovery；
- Chat Direct、Codex Session 与异步 Agent 执行之间显式的 Model-loop Ownership。

这些仍然是实现合同，只是不再承担顶层产品定位。

## 产品 Surface

- **Menu Bar：** 有界 Operational HUD。
- **macOS App：** Local Runtime Manager + Secure Machine Gateway。
- **Web Cockpit：** Operator Workspace + Resource Center。
- **Runtime / Control Plane：** 所有 Surface 共用的真源与执行 Authority。

只读 Projection 可以跨 Surface，共享显示不能自动转移高权限 Mutation Authority。Capability 归属、状态语义与 Bridge 规则继续以 [Surface 设计合同](../architecture/surface-design-contract.md) 为准。

## 明确非目标

ChatCockpit 不以以下方向为目标：

- 通用多模型聊天客户端；
- IDE Replacement；
- Universal Package Manager / App Store；
- 不受约束的 Remote Shell；
- 通用系统 Process Manager；
- Fork Codex 或其它 Provider Runtime；
- 绕过 Provider 的用量、计费、额度或安全限制。

## 贡献者规则

公开文档说明的是：**当前已发布产品保证什么，以及贡献者怎样保持这些保证。** 未来产品分支、商业选择、Provider 推进顺序、竞品评估、否决路线和内部执行计划属于私有维护者治理。
