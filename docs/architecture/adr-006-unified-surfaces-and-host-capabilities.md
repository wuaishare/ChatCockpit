# ADR-006：统一产品 Surface 与 Host Capability Resolution

- Status: Accepted
- Date: 2026-09-01
- Scope: Web Cockpit / Desktop App / Menu Bar / Device Agent / CLI / API / Runtime / Project / Device

## 背景

ChatCockpit 的 MVP 已经分别打通 Web Cockpit、macOS App、Menu Bar、Device Agent、Runtime、远程 Device Channel 与 Capability Router。早期 Surface Contract 为避免重复实现，倾向于把 Web Cockpit 定义为 Operator Workspace，把 macOS App 定义为 Machine Authority UI，并把跨 Surface 的高权限动作主要设计成 Bridge。

随着 Project Center、远程 Runtime Lifecycle、Device Agent 与多设备访问逐步成熟，这种“按 Surface 分配产品职责”的模型暴露出结构性问题：

1. 同一个用户在 Web 与 App 中会面对不同的信息架构、按钮和工作流，需要先理解“这个动作属于哪个端”。
2. Headless Linux、远程浏览器与 Desktop 都需要使用同一套 Project / Runtime / Device 能力，但执行位置并不等于 UI 所在位置。
3. Device Channel 已经证明 Web 可以安全地请求远端 Device 执行受治理能力；因此“Web 不能出现 Machine Action”不是长期成立的产品边界。
4. macOS App 若继续完整复制 Web 工作台，会形成长期双写 UI、双写状态机与双写交互合同；但若把 App 缩成纯设置器，又会浪费 Desktop 独立窗口、Menu Bar、通知、文件选择、Keychain、后台驻留等明显提升体验的能力。
5. Authority 是执行资格与安全边界，不应被错误等同为某个 Surface 的永久所有权。

## 独立行业验证

本决策不是以单一 LobeHub 实现作为依据。2026-09-01 的架构复审对多个成熟产品做了正反例交叉验证：

- **Spotify** 将桌面/Web 收敛明确描述为 **One UI, multiple containers**，通过 Platform APIs 隔离 Web 与 Desktop 容器能力；
- **VS Code** 在 Desktop/Browser 与 Local/Remote 场景中保持统一编辑体验，并用 UI / Workspace / Remote Extension Host 决定代码实际运行位置；其 Agent Host 进一步把 Host 生命周期与 Client viewer/controller 分离；
- **Slack** 长期采用 Web core + Desktop native integration，Native 层负责通知、Tray、Deep Link、Launch at Login 等 OS 能力；
- **Microsoft Teams** 使用 React/Fluent UI + Native/WebView Host + IPC/Data Layer，把核心体验与宿主能力拆层；
- **Figma / Notion** 均保持 Browser/Desktop 核心功能高度一致，同时在 Desktop 增加本机字体、插件开发、通知、Menu Bar/Taskbar 等能力；
- **GitHub Desktop / Docker Desktop** 是重要反例：当 Desktop 的核心 Job-to-be-done 本身与 Web 不同（本机 Git、Container Engine 管理）时，成熟产品会保留差异化 IA，而不是机械追求页面一致；
- **Tailscale** 的 Device Web Interface 证明 Server/Device 类产品仍需要把 Browser 管理作为 Headless/Remote 场景的一等能力。

交叉结论不是“所有 Desktop 都应该套 Web UI”，而是：**同一 Domain Model 与核心 Job-to-be-done 应优先共享 Product Experience；OS-only Job 保持 Host-specific；执行位置通过 Host/Target 抽象而不是 UI 位置决定。** 这与 ChatCockpit 的 Project / Runtime / Device / Job / Resource / Public Access Control Plane 模型吻合。

## 决策

ChatCockpit 采用 **One ChatCockpit, Multiple Hosts** 架构，并以 **Parity-first, Native-enhanced** 作为产品 Surface 原则。

### 1. 一个产品，而不是 Web 产品 + Desktop 产品

Web 与 Desktop 默认共享：

- Domain Model；
- Information Architecture；
- 页面名称与导航心智；
- Product Action；
- 状态语义；
- 工作流步骤；
- 权限词汇；
- 错误/恢复模型；
- Design System 与内容语言。

平台允许时，用户应该认为自己始终在使用同一个 ChatCockpit，而不是先判断“这个功能应该去 Web 还是 App”。

### 2. Surface 不等于 Authority

必须分离三个概念：

```text
Product Action
    -> Host Capability Resolution
    -> Authority / Policy Evaluation
    -> Execution Target
    -> Executor
```

- **Product Action**：用户想做什么，例如 Restart Runtime、Add Project Root、Open Project、Approve、Rotate Token。
- **Host Capability**：当前 Browser/Desktop/Device Agent 是否能承载该动作所需的系统能力。
- **Authority**：当前身份、设备关系、审批、Workspace/Host policy 是否允许动作执行。
- **Execution Target**：动作实际在哪台 Device 上发生。
- **Executor**：Runtime、Native Host、Device Agent、Provider Adapter 或其它受治理执行层。

同一个 Product Action 可以同时出现在 Web 与 App；可用性、执行方式和目标可以不同。

### 3. Host 类型

当前产品按 Host 能力理解入口，而不是按“主端/辅端”理解：

- **Browser Host**：完整 Cockpit UI；跨平台、Headless Server、远程访问的默认入口。
- **Desktop Host**：完整 Cockpit 体验 + Native Superpowers。
- **Device Agent Host**：无完整 GUI 的远程 Machine Executor / Capability Provider。
- **CLI/API Host**：自动化与脚本入口，消费同一 Application/Authority Contract。
- **Menu Bar**：Desktop Host 的高频 Operational HUD，不是另一套完整产品。

### 4. Native Superpowers 是增强层

Desktop 可以提供 Browser 无法可靠提供的能力：

- Native file/folder picker 与 filesystem authorization；
- Menu Bar / Tray；
- system notifications；
- Keychain / secure local secret handling；
- Runtime install/update/service lifecycle；
- startup/background residency；
- native deep link；
- clipboard and OS integration；
- local device identity and privileged diagnostics。

这些能力通过受限 Host Capability API 暴露给统一产品工作流，而不是迫使用户进入一套完全不同的 Desktop IA。

### 5. Capability-aware UI，而不是 Surface-aware UI

Action Availability 必须带明确 audience/actor 语义。当前 `/api/product-actions` 是 **Operator audience** 投影，只描述已认证人工 Operator 在 Cockpit 中的可用性；不得直接拿它给 MCP/GPT/AI actor 当授权或 availability 真源。AI actor 的执行暂停、OAuth Grant、Access Level、Approval 等规则可能与 Operator 不同，未来若需要 AI-facing projection，必须独立建模 actor/effect 并继续在执行端重验。

UI 不应使用“Web 所以隐藏”“Desktop 所以显示”作为核心产品能力的长期判断，但 **Parity 不等于所有按钮在所有 Host 上机械出现**。

先判断该 Action 是否属于跨 Host 的核心产品工作流：Project、Runtime、Device、Job、Resource、Public Access 等核心 Cockpit Action 应尽量保持同一心智与可发现性；Menu Bar 配置、Launch at Login、Keychain 管理、Desktop Auto Update 等纯 Host Preference / OS Integration 则可以只存在于对应 Host。

对于跨 Host Product Action，应解析为明确状态，例如：

- `available-local`：当前 Host/Device 可直接执行；
- `available-targeted`：选择另一已连接 Device 后可执行；
- `requires-local-host`：动作真实存在，但当前请求上下文不具备本机 Host 能力；
- `approval-required`：Host 可执行，但需要受治理审批；
- `offline`：目标存在但当前离线；
- `unsupported`：目标当前 Agent/Runtime 版本不支持；
- `forbidden`：Authority/Policy 不允许；
- `unavailable`：当前没有任何合法执行路径。

当 Action 对当前用户任务有重要可发现性时，Unavailable 应给出原因和恢复路径；当它本身就是无关的 Host-only Preference 时，不要求为了“页面一致”而在其它 Host 中制造禁用按钮。

### 6. Project 模型应用

Project / Project Root / Primary Root / Execution Workspace 是同一套产品概念，应在 Web 与 Desktop 中保持一致。

例如 `Add Project Root`：

- Desktop Host 在已授权的 machine-local context 中可使用原生 folder picker 与本机 Project mutation contract；
- 本机 Browser 只有在当前 Runtime 本身提供合法的 machine-local mutation endpoint，或存在被明确检测/attest 的 Native Host executor 时，才可执行；“浏览器位于本机”本身不是 Native Bridge 存在的证据；
- 远程 Browser 只有在已连接 Device 明确声明并实现对应 Project mutation contract 时，才可选择该 Device 作为 executor；当前 Device Agent 尚未提供该 RPC 时必须投影 `unsupported / target-capability-not-implemented`；
- 没有合法 Host Capability 时仍可保留该核心 Product Action 的可发现性，但必须明确解释真实原因与恢复路径，不能根据平台猜测执行能力。

因此 Project Root 的 **Machine Authority** 约束“谁能执行”，而不是规定“Web 页面不能有该动作”。

### 7. Runtime Lifecycle 应统一成 Target-aware Product Action

Restart/Start/Stop Runtime 在 Desktop 与 Web 中属于同一个产品动作：

- Desktop 默认 target = This Device；
- Web 可以 target = local-device 或已配对 Device；
- Device Agent 当前已有 Runtime Lifecycle RPC 时直接作为远程 executor；
- 不支持的 Device 必须显示版本/能力不可用，而不是提供假按钮或错误归零。

### 8. Shared Renderer 可以评估，但禁止 Dumb Wrapper

本 ADR **不立即决定** Desktop Renderer 技术栈。现有 SwiftUI App 继续作为已验证 Native Capability Host，直到 Host Capability Contract 与共享产品 IA 稳定。

后续允许评估：

- SwiftUI thin host + shared Web renderer；
- Electron + shared React renderer；
- Tauri 或其它可证明安全边界的 Desktop Host；
- 保留部分 SwiftUI Native Views + shared Cockpit UI。

禁止的是“加载一个网页就结束”的 Dumb Wrapper，而不是共享 Web UI 本身。任何共享 renderer 都必须满足：

- renderer 无任意 Node/shell 权限；
- context/isolation 或等价进程隔离；
- typed + allowlisted Host Capability bridge；
- secrets 不进入普通 renderer state；
- Machine Mutation 继续经过 Authority/Approval/Governance；
- Runtime/Application Service 保持业务真源。

### 9. 当前 Capability Router 与 Device Channel 是可复用地基

现有 `TargetedCapabilityRouterService`、`DeviceTargetService`、Device Capability RPC、Device Runtime Lifecycle RPC、Host Permission、Governance Ledger 不废弃。

Device Channel 的 **wire protocol version 与 capability set 必须正交**。Legacy v1-v4 channel 为兼容旧 Agent 继续按历史版本语义读取；v5 channel-open 必须把 canonical capability attestation 纳入设备 Ed25519 签名 proof，Hub 只按已签名的 `capability-rpc`、`workspace-rpc`、`runtime-lifecycle` 等能力事实决定可用性。平台名称、连接在线、通用 RPC 可达或较高 protocol version 都不能替代 capability attestation，也不能通过剥离 attestation 降级成更宽权限。

新增的 Host Capability Resolution 层应优先组合这些已有事实，而不是创建第二个远程执行系统。

## 迁移顺序

1. 建立稳定的 Host Capability / Product Action availability projection。
2. 修正 Surface Contract 与 Product Principles：Surface ≠ Authority。
3. Project Center/Cockpit 迁移到 capability-aware target resolution；停止“按 Surface 删除功能”。
4. Runtime lifecycle、Public Access、Device、Resource Center 等逐步采用同一 Action Availability Contract。
5. 收敛 Web/Desktop IA、状态、文案和交互合同。
6. 在共享产品架构稳定后，单独评估 Desktop Renderer 技术路线和迁移成本。
7. 最后再扩 Windows/Linux Desktop distribution。

## 安全不变量

统一体验不能降低既有安全边界：

- machine secret 不因 UI parity 进入 Web public projection；
- remote browser 不能因为显示 Machine Action 就获得 Machine Authority；
- Device Agent 必须独立重验本地 containment/policy；
- mutation 必须保留 CSRF、approval、idempotency、revision、actor provenance 与 audit contract；
- absolute local paths 只有拥有对应 machine-local/private projection 的 Host/actor 可见；
- UI capability availability 只是 projection，不是授权凭据。

## 结果

ChatCockpit 的长期心智从：

```text
Web -> Operator features
App -> Machine features
```

调整为：

```text
                    ChatCockpit Product
                           |
                    Product Actions
                           |
                 Host Capability Resolver
                           |
                   Authority / Governance
                           |
          +----------------+----------------+
          |                |                |
      local-device    remote Device      Provider
          |                |                |
     Native/Runtime    Device Agent       Adapter
```

目标是 **Same Product. Same Workflow. Same Mental Model. Different Host. Different Native Capabilities.**
