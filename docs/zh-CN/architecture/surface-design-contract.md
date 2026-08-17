# ChatCockpit Surface 设计合同

ChatCockpit 会通过多个产品 Surface 展示同一套 Runtime，但这些界面**不是彼此的复制品**。本合同明确每个 Surface 的职责、状态和动作如何保持一致，以及哪些能力应该跳转到真正的归属界面，而不是重复实现。

目标是在保持统一产品体验的同时，避免把本机管理、Operator 工作流和高频快捷操作全部堆进同一个界面。

## Surface 职责

### Menu Bar — Operational HUD

菜单栏是一个有明确边界、适合快速扫读的 **Operational HUD（运维抬头显示）**。

它主要快速回答四个问题：

- ChatCockpit 现在是否健康；
- 是否有任务正在运行、排队、失败或等待审批；
- 是否存在需要关注的访问、安全或更新问题；
- 当前最常用的本机操作是什么。

它可以提供刷新、启动、停止、重启、打开本机/公网控制台以及进入主 App 等安全高频动作，但不能膨胀成完整设置中心、秘密管理控制台或工作流工作台。

### macOS App — Local Runtime Manager + Secure Machine Gateway

原生 App 持有当前 Mac 的 **Machine Authority（机器权限）**。

凡是依赖本机系统权限、本地文件系统、原生秘密处理或 Runtime 所有权的操作，都应由 App 作为主入口，包括：

- Runtime 启动 / 停止 / 重启；
- Developer / Packaged Mode；
- listener、端口、控制台入口路径和 Trusted LAN；
- 本机 Runtime 安装与更新状态；
- Primary Workspace 与本机工作区授权；
- 机器 API Token 明文显示 / 复制 / 轮换；
- 本机 Web Owner 初始化凭据；
- 一次性 loopback 免密进入控制台；
- 本机诊断与原生初始化流程。

App 可以投影少量 Operator 信息，但对数据密集型工作流应跳转 Web Cockpit，而不是再实现一套缩小版管理后台。

### Web Cockpit — Operator Workspace

Web Cockpit 持有 **Operator Authority（操作员权限）**，承担完整的数据密集型工作台。

它是以下能力的主界面：

- Project、Task、Session、Handoff 与 Evidence；
- Job 与 Approval 工作流；
- Runtime Profile 与 Resource Center；
- Integrations、ChatGPT OAuth 与 Passkey；
- 机器已授权 Workspace 之后的受治理工作流使用；
- 审计历史与工作流检查。

Web Cockpit 可以显示 public-safe 的机器状态，但不能展示本机秘密，也不能成为第二套本机 Runtime 所有权实现。

公网暴露能力在 Web Cockpit 中归入独立的 **公网接入 / Public Access（Connectivity）** 工作台。Web 负责 Provider 选择、域名/路由意图、Canonical Public Endpoint 选择、可达性/TLS/DNS 检查以及 staged cutover 工作流；它不负责安装本机二进制、修改 OS Service，也不渲染 Provider 凭据明文。当前已实现的工作台还会消费受保护的 public-safe 机器 Provider 投影，其中只包含 Provider identity/display name、探测状态、版本、ChatCockpit ownership 以及动作可用性/原因；机器执行、内部 Adapter identity、可执行文件路径、Provider 原始输出、Mutation Plan 与 Secret 继续严格留在 Web 之外。

### Runtime — 唯一业务真源与执行层

Runtime 仍然是权威实现层。Menu Bar、App 与 Web Cockpit 应消费同一套 Runtime / Application Projection，而不是各自重新推断业务真相。

不同 Surface 可以根据平台改变布局、信息密度和交互形式，但不得分叉 Runtime 生命周期、安全、Continuity、Approval、OAuth 或 Mutation 规则。

## 跨 Surface 规则

1. **只读投影可以跨 Surface，Mutation 权限不能跨。** 一个界面可以摘要展示别处拥有的状态，但不能因此继承对方的高权限动作。
2. **优先 Bridge，不重复实现。** 任务明确属于另一 Surface 时，应通过原生导航或 Deep Link 前往主界面，而不是再做一套简化实现。当前 Web → App 的 Connectivity Bridge 使用固定的纯导航 URL `chatcockpit://settings/connectivity`；它不携带 Provider、Action、Mutation Plan 或 Secret 参数，也绝不能因为打开链接本身就执行任何机器 Mutation。
3. **秘密保持 machine-local。** 机器 API Token 明文和初始化 Owner 密码绝不能出现在 Web Cockpit 或 Menu Bar。
4. **Web 不接管本机生命周期。** Web Cockpit 可以显示 Runtime 状态，但不负责原生服务 start / stop / restart 或 LaunchAgent Mutation。
5. **App 不复制工作流工作台。** App 可以摘要 Jobs、Approvals、Integrations 或 Continuity 状态，再打开 Web Cockpit 处理详情。
6. **不使用 WKWebView 套壳解决一致性。** Native 与 Web 共享的是产品语义和视觉语言，不是实现技术。
7. **所有 Web 跳转都使用真实控制台入口。** 不得假设固定 `/ui`。
8. **Unavailable 不是 0。** 读不到运维投影时必须显示 unknown / unavailable，不能伪造为 `0` 或健康。
9. **Connectivity 必须 Provider-neutral。** 公网接入围绕 Endpoint、Route、Provider、Health 与 Diagnostics 建模，不能让 ServBay、FRP、Cloudflare Tunnel、ngrok、Pinggy 或任何其他 Provider 变成核心产品身份的一部分。
10. **默认不安装任何 Provider。** Connectivity Provider 全部可选；已有环境可以检测并复用。安装、升级、卸载以及本机 Service Mutation 必须经过明确的 Machine Authority。
11. **公网端点切换必须 staged cutover。** 先配置并验证候选 Route，再将其提升为 Canonical Public Endpoint；候选失败不能破坏当前仍然可用的公网入口。
12. **Provider Secret 必须保持 machine-local。** Web 可以显示已配置/缺失状态并发起 Machine Bridge，但 Tunnel Token、FRP 凭据、Provider Auth Token 等明文绝不能进入 Web 渲染层。

## 统一状态语义

所有 Surface 都必须把自己的组件状态映射为同一套七态语义。颜色只作为辅助信息，文字和图标仍要能独立表达含义，以满足无障碍要求。

| Semantic | 含义 | 典型视觉角色 |
| --- | --- | --- |
| `healthy` | 就绪、已连接、已验证，或没有待处理事项 | 绿色 success |
| `active` | 正在运行或处理中 | 蓝色 activity |
| `pending` | 等待完成、审核或 Operator 操作 | 橙色 pending |
| `warning` | 降级、可恢复问题或需要关注 | 橙色 warning |
| `danger` | 失败、阻塞、冲突或高风险动作 | 红色 danger |
| `inactive` | 主动停止、禁用或未启用 | 次级灰色 |
| `unknown` | 当前无法判断或能力不可用 | 三级灰色 |

能使用系统原生动态颜色和 Accessibility API 时应优先使用。合同约束的是语义，而不是固定 RGB 值。

## 统一动作语言

即使 Native 和 Web 使用不同图标库，动作意图也应保持稳定。

| Intent | Native / Web 表现 | 必须满足的行为 |
| --- | --- | --- |
| 打开 / Bridge | external/open 图标 | 明确目标并打开真正的主 Surface |
| 复制 | copy 图标 | 反馈只属于当前动作并自动消失，不能变成长期全局提示 |
| 刷新 | refresh 图标 | 重新读取权威状态，不能暗示 Mutation 已成功 |
| 重启 | restart/cycle 图标 | 是明确 Runtime 生命周期动作，不能隐藏在 Refresh 里 |
| 显示秘密 | eye 图标 | 必须显式触发、临时显示、仅限本机 |
| 设置 / 配置 | gear 图标 | 打开真正拥有配置权的 Surface 或对应 Section |
| 危险动作 | 平台 destructive role | 后果不易恢复时必须有清楚标签和确认 |

纯图标交互必须同时具备 Accessible Name、键盘焦点以及平台适合的 pointer / hover 反馈。

## Capability Placement Matrix

`Observe` 表示可以显示受限只读投影；`Act` 表示该 Surface 拥有 Mutation；`Bridge` 表示应该导航到真正归属界面；`None` 表示不应该出现此能力。

| Capability | Menu Bar | macOS App | Web Cockpit | Authority |
| --- | --- | --- | --- | --- |
| Runtime 整体健康 | Observe | Observe | Observe | Runtime |
| 启动 / 停止 / 重启本机 Runtime | Act | Act | Observe | Machine |
| Developer / Packaged Mode 与 Runtime 安装 | Bridge | Act | Observe | Machine |
| Listener / 端口 / 控制台入口 / Trusted LAN | Observe | Act | Observe | Machine |
| 机器 API Token 明文 / 轮换 | None | Act | 仅 Observe 已配置状态 | Machine |
| 本机 Web Owner 初始化凭据 | None | Act | None | Machine |
| Web Owner Session / Passkey / 密码+TOTP 登录 | None | Bridge | Act | Operator |
| 一次性本机免密进入控制台 | Act | Act | 仅 Consume | Machine |
| 本机 Workspace 授权 / Primary Workspace | None | Act | Observe 已授权 Workspace | Machine |
| 受治理 Workspace 工作流使用 | Observe 摘要 | Bridge | Act | Operator |
| Jobs / Queue / Failures | Observe 摘要 | Observe 摘要 + Bridge | Act | Operator |
| Approvals | Observe 摘要 | Observe 摘要 + Bridge | Act | Operator |
| Continuity / Tasks / Sessions / Handoffs / Evidence | None | Bridge | Act | Operator |
| Integrations / ChatGPT OAuth / Passkeys | None | Observe 状态 + Bridge | Act | Operator |
| Public Endpoint / 可达性 / TLS / DNS | Observe 摘要 | Observe 摘要 + Bridge | Act | Operator |
| Connectivity Provider 选择 / 域名 / Route 意图 | None | Observe 状态 + Bridge | Act | Operator |
| Connectivity Provider 安装 / 更新 / 卸载 | None | Act | Bridge | Machine |
| Connectivity Provider 本机 Service 生命周期 | Observe 摘要 | Act | Observe | Machine |
| Connectivity Provider 凭据明文 | None | Act | None | Machine |
| Tunnel Route 健康 / 日志 / 诊断 | Observe 摘要 | Observe 摘要 + Bridge | Act | Runtime |
| App / Runtime 更新管理 | Observe 状态 + Bridge | Act | None | Machine |
| 本机诊断 / Ownership Conflict | Observe 摘要 + Bridge | Act | None | Machine |
| Audit 与工作流历史 | None | Bridge | Act | Operator |

一个新能力如果要出现在多个 Surface，必须先进入这张 Matrix。若 Authority 仍然不清楚，应先解决权限边界，而不是先把重复按钮做出来。

## 信息密度原则

一致并不等于信息量完全相同。

- **Menu Bar：** 第一屏可扫读摘要，不做滚动型工作台，也不放大型配置表单。
- **macOS App：** 高密度原生管理中心，保持稳定 Sidebar、紧凑卡片/行与本机管理动作。
- **Web Cockpit：** 承担最高数据密度，适合工作流表格、历史、资源、审批和多对象操作。

同一信息可以因为“决策速度不同”而在不同 Surface 重复摘要，但详细真源仍属于能力的主 Surface。

## Canonical 术语

用户可见语言应围绕同一套概念收口：

- Control Plane / 控制平面
- Runner / 任务运行器
- Process Supervisor / 进程监控器
- Local Cockpit / 本机控制台
- Public Cockpit / 公网控制台
- Console path / 控制台入口路径
- Trusted LAN / 可信局域网
- Web Owner / 控制台管理员
- Machine API Token / 机器 API 令牌
- Passkey / 通用密钥
- TOTP two-factor authentication / TOTP 双重认证
- Recovery codes / 恢复码
- ChatGPT OAuth
- Public Access / 公网接入
- Connectivity Provider / 接入组件
- Public Endpoint / 公网端点

不同语言可以调整语序与表达，但不能针对同一个 Authority 或 Endpoint 再造第二套产品概念。

## 贡献者检查清单

新增或移动 UI 能力之前：

1. 明确它属于 Runtime、Machine 还是 Operator Authority。
2. 检查 Capability Placement Matrix。
3. 复用权威 Projection / Service，不要在 Surface 内自行推断状态。
4. 使用统一七态语义。
5. 其他 Surface 已拥有该任务时优先 Bridge。
6. 机器秘密不得进入 Web 与 Menu Bar。
7. 保持真实 Console Path 路由与本地化。
8. 当边界在实现层可被自动验证时，同步增加或更新门禁。

本合同与[产品原则](../governance/product-principles.md)、[macOS Desktop 合同](../deployment/macos-desktop.md)、[Connectivity Provider 机器变更合同](./connectivity-provider-machine-mutation.md)、[Connectivity 候选 Route 暂存合同](./connectivity-route-staging.md)以及英文版 [Web UI Design System](../../architecture/web-ui-design-system.md)共同构成公开的 Surface 设计约束。
