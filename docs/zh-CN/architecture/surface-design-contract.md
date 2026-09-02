# ChatCockpit Surface 设计合同

ChatCockpit 通过多个 Host 与展示 Surface 提供同一个产品。Web 与 Desktop 默认共享同一套核心 Domain Model、Information Architecture、Product Action、状态语言与工作流语义；不同平台 Host 可以增加 Native Capability，但不能因此制造第二套产品模型。

目标是 **Parity-first, Native-enhanced**：Browser 与 Desktop 保持统一的核心 Cockpit 体验，同时把真实执行交给 Host Capability、Authority/Governance 与明确的 Device/Provider Target 解析。Surface 是呈现层，不是权限边界。详见 ADR-006。

## Surface 职责

### Menu Bar — Operational HUD

菜单栏是一个有明确边界、适合快速扫读的 **Operational HUD（运维抬头显示）**。

它主要快速回答四个问题：

- ChatCockpit 现在是否健康；
- 是否有任务正在运行、排队、失败或等待审批；
- 是否存在需要关注的访问、安全或更新问题；
- 当前最常用的本机操作是什么。

它可以提供刷新、启动、停止、重启、打开本机/公网控制台以及进入主 App 等安全高频动作，但不能膨胀成完整设置中心、秘密管理控制台或工作流工作台。

### macOS App — Full Cockpit Host + Native Capability Provider

原生 App 提供完整 ChatCockpit 核心体验，同时为当前 Mac 提供额外的 **Native Host Capability**。

凡是依赖本机系统权限、本地文件系统、原生秘密处理或 Runtime 所有权的操作，只要 Authority/Governance 允许，都可以由 Desktop Host 作为执行端，包括：

- Runtime 启动 / 停止 / 重启；
- Developer / Packaged Mode；
- listener、端口、控制台入口路径和 Trusted LAN；
- 本机 Runtime 安装与更新状态；
- Project Root 选择、Primary Root 变更、本机文件系统授权与 Execution Workspace 映射；
- 机器 API Token 明文显示 / 复制 / 轮换；
- 本机 Web Owner 初始化凭据；
- 一次性 loopback 免密进入控制台；
- 本机诊断与原生初始化流程。

App 不应因为拥有更多本机权限就分叉 Product Action 或工作流状态机。Project / Runtime / Device / Job / Resource / Public Access 等核心流程应与 Web Cockpit 保持同一产品语义；Menu Bar 行为、Launch at Login、Keychain、Desktop 更新策略等纯 Host Preference 可以保留为 Native-only。

### Web Cockpit — Full Cockpit Browser Host

Web Cockpit 是完整的浏览器版 ChatCockpit，也是 Headless Linux、跨设备远程管理、移动/第二设备访问以及不适合安装 Desktop 客户端环境中的第一等入口。

它应呈现与 Desktop 一致的核心产品域，包括：

- Project 目录、项目元数据、Task、Session、Handoff 与 Evidence；
- Job 与 Approval 工作流；
- Runtime Profile 与 Resource Center；
- Integrations、ChatGPT OAuth 与 Passkey；
- public-safe 的 Project Root / Execution Workspace 状态，以及机器完成本机目录授权后的受治理执行；
- 审计历史与工作流检查。

当存在合法执行路径时，Web Cockpit 可以呈现 Machine-oriented Product Action，例如通过已配对 Device Agent 或本机 Host Context 请求执行。动作可见绝不等于获得 Machine Authority：Secret、绝对路径/private projection、Host Permission、Approval 与真实执行都必须由目标侧服务继续强制校验。没有合法路径时必须明确显示 unavailable / requires-local-host / unsupported，而不能伪造成功。

公网暴露能力在 Web Cockpit 中归入独立的 **公网接入 / Public Access（Connectivity）** 工作台。Web 负责 Provider 选择、域名/路由意图、Canonical Public Endpoint 选择、可达性/TLS/DNS 检查以及 staged cutover 工作流；它不负责安装本机二进制、修改 OS Service，也不渲染 Provider 凭据明文。当前已实现的工作台会消费受保护的 public-safe 机器 Provider 投影，并将 Candidate Public Route 与 canonical Runtime origin 分离暂存。当 canonical 已存在时，Web 会对 exact candidate 执行受限的 public-unicast DNS + 固定 IP HTTPS 显式验证，并允许基于成功 Verification Artifact 准备或取消短期 replacement Cutover Intent；当 Runtime 仍是 local-only 时，Web 改用短期 Bootstrap Identity Proof，其中随机 challenge 只保存在本机，并在 same-Runtime 身份验证成功后立即销毁。Verification、Bootstrap Proof 与 Intent 只向 Web 投影受限 public-safe 状态；challenge 值、解析 IP、原始 TLS/网络错误、响应正文、Runtime Service 执行、内部 Adapter identity、可执行文件路径、Provider 原始输出、Mutation 命令与 Secret 继续严格留在 Web 之外。Replacement Cutover 与首次公网 Machine Bootstrap Execution 都只在 macOS App / CLI Machine Authority 中实现；Web 不存在执行 endpoint，也不能写 Runtime 配置或 restart 服务。首次公网 Bootstrap 继续保持独立的 Proof + Execution 合同：只消费 exact verified Bootstrap Proof，绝不自动启动已停止的 Runtime，并在 running Runtime 事务失败时 rollback 回 local-only。

### Runtime — 唯一业务真源与执行层

Runtime 仍然是权威实现层。Menu Bar、App 与 Web Cockpit 应消费同一套 Runtime / Application Projection，而不是各自重新推断业务真相。

不同 Surface 可以根据平台改变布局、信息密度和交互形式，但不得分叉 Runtime 生命周期、安全、Continuity、Approval、OAuth 或 Mutation 规则。

## 跨 Surface 规则

1. **Surface 是呈现层，不是 Authority。** Product Action 可以同时出现在 Web 与 Desktop，但当前 Client 是否有资格执行必须由独立的 Authority/Governance 判断。
2. **核心 Product Action 跨 Host 保持同一心智。** Project、Runtime、Device、Job、Resource、Public Access、Integration、Approval 与 Continuity 应尽量共享同一 Domain Model、动作词汇和状态语义。
3. **Host-only Preference 保持 Host-only。** Menu Bar 设置、Launch at Login、Keychain、Desktop 更新策略、Dock/Window Preference 等 OS Integration 不需要为了视觉一致而复制到 Browser。
4. **执行前先解析。** Machine-oriented Action 必须先解析 Host Capability、Authority/Policy 与 Execution Target；Browser 可以请求由已配对 Device Agent 执行，Desktop 也可以在本机执行同一 Product Action。
5. **不得编造 Bridge。** 只有真实检测/Attest 到 Desktop/Agent Capability 后，`requires-local-host` 才能升级成 Native Bridge；UI 不能因为“理论上装 App 会有帮助”就假装本机已安装。同样不得编造恢复原因：对于 v5 已签名 capability set，缺少某项能力只表示当前 Agent 没有 attestation 该能力；只有 legacy 协议本身无法表达该能力时，才可以提示需要升级 Agent。
6. **秘密保持 machine-local。** Machine API Token、初始化 Owner 密码、Provider Credential 与其它 Host Private Material 绝不能因为 UI parity 进入公开投影。
7. **共享工作流真相，不强绑 Renderer 技术。** Native 与 Web 应共享产品语义、Application Contract，并在安全和经济性成立时复用 UI；Desktop Renderer 技术路线是 ADR-006 约束下的独立实现决策。
8. **安全登录入口与稳定 Cockpit 路由必须分开建模。** `consolePathPrefix` 是新的未认证 Web 登录所经过的可配置安全入口；认证后的 Cockpit 导航使用稳定的 `/ui/*` 路由族。Host 不得用安全登录入口替代认证后的 deep link，也不能把稳定 Cockpit 路由误当成秘密地址。
9. **Unavailable 不是 0。** 读不到运维投影时必须显示 unknown / unavailable，不能伪造为 `0` 或健康。
10. **Connectivity 必须 Provider-neutral。** 公网接入围绕 Endpoint、Route、Provider、Health 与 Diagnostics 建模，不能让 ServBay、FRP、Cloudflare Tunnel、ngrok、Pinggy 或任何其他 Provider 变成核心产品身份的一部分。
11. **默认不安装任何 Provider。** Connectivity Provider 全部可选；已有环境可以检测并复用。安装、升级、卸载以及本机 Service Mutation 必须经过明确的 Machine Authority。
12. **公网端点切换必须 staged cutover。** 先配置并验证候选 Route，再将其提升为 Canonical Public Endpoint；候选失败不能破坏当前仍然可用的公网入口。
13. **Provider Secret 必须保持 machine-local。** Web 可以显示已配置/缺失状态与 Action Availability，但 Tunnel Token、FRP 凭据、Provider Auth Token 等明文绝不能进入 public rendering。
14. **Project 身份与文件系统 Authority 是两个关注点，不是两个产品。** Project / Project Root / Primary Root / Execution Workspace 在 Web 与 Desktop 中保持同一产品概念；Root Discovery、绝对路径和文件系统 Mutation 仍要求已授权 Execution Host/Device，Web 只有在存在合法 target-aware executor 时才能驱动同一个 Product Action。
15. **Project Execution 不是 Machine Authority。** Native Workspace Execution 只能按已解析 effect 读写当前 Workspace，并只读执行该项目所必需的显式 Toolchain/Runtime Root；临时文件必须使用每 Workspace 独立的 dedicated scratch。ChatCockpit state、Home Secret Root、全局临时目录以及携带 Secret 的 Control Plane Environment 默认拒绝。Machine-local Secret 或 Host Administration 必须走独立 Host/Device Capability Contract；“项目代码恰好运行在同一台机器”本身绝不授予 Machine Authority。

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

Matrix 描述的是**产品可见性与执行要求**，不是某个 Surface 独占 Authority。`Full` 表示核心工作流在条件允许时应完整可用；`Summary` 是有界 HUD；`Host-only` 是有意保留的平台能力；`Target-aware` 表示执行可以发生在本机或另一台已授权 Device。Authority 始终独立判断。

| Capability | Menu Bar | Desktop Host | Browser Host | Execution / Authority |
| --- | --- | --- | --- | --- |
| Runtime 整体健康 | Summary | Full | Full | Runtime truth |
| 启动 / 停止 / 重启 Runtime | Quick action | Full | Full，target-aware | Machine + target capability |
| Developer / Packaged Mode 与 Runtime 安装 | Summary / open | Full | Status + actionable availability | Local Host capability |
| Listener / 端口 / 控制台入口 / Trusted LAN | Summary | Full | 有合法 target executor 时 Full | Machine + target capability |
| 机器 API Token 明文 / 轮换 | None | Host-only | 仅配置状态 | Machine secret authority |
| 本机 Web Owner 初始化凭据 | None | Host-only | None | Machine secret authority |
| Web Owner Session / Passkey / 密码+TOTP 登录 | None | Full/shared flow | Full | Operator auth |
| 一次性本机免密进入控制台 | Quick open | Full | 仅 Consume | Machine-local grant |
| Project 目录 / 项目元数据 | Summary | Full | Full | Operator/project authority |
| Project Root / Primary Root / Execution Workspace 管理 | None | Full | Full，target-aware | Machine filesystem + target capability |
| 受治理 Execution Workspace 工作流使用 | Summary | Full | Full | Workspace governance |
| Jobs / Queue / Failures | Summary | Full | Full | Operator/governance |
| Approvals | Summary | Full | Full | Approval policy |
| Continuity / Tasks / Sessions / Handoffs / Evidence | Open / useful summary | Full | Full | Operator/governance |
| Integrations / ChatGPT OAuth / Passkeys | None | Full | Full | Operator auth/integration policy |
| Public Endpoint / 可达性 / TLS / DNS | Summary | Full | Full | Runtime + network truth |
| Connectivity Provider 选择 / 域名 / Route 意图 | None | Full | Full | Operator intent |
| Connectivity Provider 安装 / 更新 / 卸载 | None | Full | Full availability，target-aware | Machine + target capability |
| Connectivity Provider 本机 Service 生命周期 | Summary | Full | Full availability，target-aware | Machine + target capability |
| Connectivity Provider 凭据明文 | None | Host-only | None | Machine secret authority |
| Tunnel Route 健康 / 日志 / 诊断 | Summary | Full | Full | Runtime/provider projection |
| Desktop App 更新 / Launch at Login / Menu Bar Preference | Host-only | Host-only | None | Desktop Host |
| 本机诊断 / Ownership Conflict | Summary / open | Full | public-safe status + target-aware diagnostics | Machine + target capability |
| Audit 与工作流历史 | None | Full | Full | Operator/governance |

一个能力要扩展到多个 Host 前，必须先定义 Product Action、所需 Host Capability、Authority/Policy、Target 语义、public-safe Projection 与 unavailable-state 行为。不得仅因为 Renderer 或操作系统不同就创造第二套业务工作流。

## 信息密度原则

一致并不等于信息量完全相同。

- **Menu Bar：** 第一屏可扫读摘要，不做滚动型工作台，也不放大型配置表单。
- **Desktop Host：** 完整 Cockpit，采用适合桌面的信息密度，同时承载 Native Control 与 Host-only Preference。
- **Browser Host：** 完整 Cockpit，重点适配远程/Headless 场景、响应式布局以及数据密集型工作流。

同一信息可以因为决策速度或 Host Affordance 不同而重复摘要；Runtime/Application Layer 才是 canonical truth，任何 Renderer 都不能变成第二套业务真源。

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
- Project / 项目
- Project Root / 项目目录
- Primary Root / 主项目目录
- Execution Workspace / 执行工作区
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

1. 先定义 Product Action 与 Domain Object，再决定 Renderer 上使用什么控件。
2. 明确所需 Host Capability、Authority/Policy、Execution Target 与 Executor。
3. 检查 Capability Placement Matrix 与 ADR-006。
4. 复用权威 Runtime/Application Projection，不要在 Surface 内自行推断状态。
5. 使用统一状态/动作语义，并真实展示 unavailable / requires-local-host / unsupported 等状态。
6. 机器 Secret 与 private path material 不得进入 public/browser projection。
7. 保持真实 Console Path、Localization、Target Identity、Idempotency、Revision、Approval 与 Audit Contract。
8. 当边界可自动验证时，同步增加 Host parity、target resolution 与 negative-state 门禁。

本合同与[产品原则](../governance/product-principles.md)、[macOS Desktop 合同](../deployment/macos-desktop.md)、[Connectivity Provider 机器变更合同](./connectivity-provider-machine-mutation.md)、[Connectivity 候选 Route 暂存合同](./connectivity-route-staging.md)、[Public Route Cutover Intent 合同](./connectivity-route-cutover.md)、[首次公网 Route Bootstrap Identity Proof 合同](./connectivity-route-bootstrap.md)以及英文版 [Web UI Design System](../../architecture/web-ui-design-system.md)共同构成公开的 Surface 设计约束。


跨端视觉与品牌 Token 以 [ChatCockpit 设计系统](./design-system.md) 为准。
