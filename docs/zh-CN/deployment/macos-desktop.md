# ChatCockpit Desktop for macOS

ChatCockpit Desktop 是现有 ChatCockpit Node Control Plane 之上的原生 SwiftUI 操作壳层。Phase 2 在保持 Node/TypeScript Control Plane、Runner、Process Supervisor、Web Cockpit、MCP、OAuth、Continuity、Codex、Approval 与 Resource Center 单一业务真源的前提下，加入了 Self-contained Packaged Runtime。

原生 App 按 [Surface 设计合同](../architecture/surface-design-contract.md) 与 ADR-006 定义为 **Full Cockpit Host + Native Capability Provider**：它与 Browser 呈现同一套核心 ChatCockpit 产品模型，同时增加 Runtime 生命周期、文件系统授权、本机 Secret、Menu Bar、系统通知与 OS Integration 等 Native Capability。Surface 所在位置本身不授予 Authority；高权限动作仍必须经过 Host Capability、Policy、Approval 与 Execution Target 治理。

## Phase 2 当前边界

Desktop App 现在明确支持两种运行模式。

### Packaged Mode

Packaged Mode 是普通桌面使用场景的 Self-contained 路径：

- `.app` 自带经过校验的 ChatCockpit Runtime Payload；
- Payload 内置当前 macOS 架构对应的精确 Node.js `24.18.1`；
- 首次使用时把内嵌 Payload 部署到 `~/Library/Application Support/ChatCockpit/runtimes/` 下的版本化 Runtime；
- 可写 ChatCockpit 状态独立放在 `~/Library/Application Support/ChatCockpit/state/`；
- 本机私有配置独立放在 `~/Library/Application Support/ChatCockpit/config/`；
- 用户通过 **项目** 管理 Project 与 Project Root；每个 Project 有一个 Primary Root，Git Project Root 可提供带稳定 repo ID 的 **Execution Workspace**，Packaged Mode 从可执行工作区中选择 Runtime bootstrap，而不会把它与 Primary Root 混为一谈；
- Runtime 目录不会冒充用户 Workspace；
- 启动 ChatCockpit 不要求系统安装 `node` 或 `npm`；
- Packaged App 运行时不要求存在 ChatCockpit 源码 checkout。

Git、Python、Codex 等外部工具仍可能是某些具体能力的依赖，但它们缺失时不会让 Packaged Control Plane 本身无法启动。

### Developer Mode

Developer Mode 保留原有源码工作流：

- 选择合法的 ChatCockpit 源码或已构建 checkout；
- 使用系统 Node.js `>=22.13.0`；
- Source/Developer Mode Runtime 状态统一放在全局 `~/.chatcockpit/`，与选中的 checkout 分离；
- 继续使用现有 source-oriented setup、doctor 与开发命令。

Developer Mode 仍面向贡献者和维护者。Phase 2 不会删除它，也不会静默把它迁移掉。

### App 首次启动与模式选择

ChatCockpit 是正常的前台 macOS App：启动后会直接显示 **ChatCockpit Status** 主窗口，Dock 中可见，同时保留菜单栏状态项作为快速控制入口。主窗口使用可滚动内容区与固定动作栏，窗口恢复到较小尺寸时也不应裁切状态头或底部操作。

首次启动时，如果能发现合法 ChatCockpit source checkout，Desktop 优先进入 **Developer Mode**；否则在存在有效 bundled runtime 时进入 **Packaged Mode**。用户之后显式选择的 Developer/Packaged Mode 会写入本机偏好并在下次启动时优先恢复；若记忆模式不再可用，则按当前可用 Runtime 安全回退。

## Runtime 与 Workspace 分离

Packaged Mode 明确区分四种根：

```text
ChatCockpit.app
├── Contents/Resources/TokenPilotRuntime/       App 内只读 Runtime Payload（内部实现目录名）

~/Library/Application Support/ChatCockpit/
├── runtimes/<runtime-id>/                      部署后的 immutable Runtime
├── state/                                      可写本机 Runtime State
└── config/                                     本机私有配置

<项目目录 A>/                                   Project Root（可以是 Git，也可以是普通目录）
<项目目录 B>/                                   可选的附加 Project Root
```

部署后的 Runtime 与 Application Support State 永远不是 Project Root，也不会自动获得执行授权。Packaged 项目治理持久化在私有 `config/config.json` 的 canonical schema v3：`projects + projectRoots + executionWorkspaces`。Project 拥有一个 Primary Root；只有可执行的 Git Root 才建立 Execution Workspace。`defaultRepoId / repoMappings` 等仅作为迁移期兼容投影读取，不再是 canonical 持久化模型；Desktop 与 Runtime 消费同一 Registry，不另建第二套工作区数据库。

## Bundled Node 供应链合同

Phase 2 Runtime Manifest 将 Node.js 精确固定为：

```text
24.18.1
```

仓库分别记录 Node 官方发布物与 SHA256：

- `darwin-arm64`；
- `darwin-x64`。

Runtime Payload 构建只读取仓库中已审核的 Manifest，不在构建时动态解析 `latest-v24.x`。Node 下载发生在**构建阶段**，普通 Packaged App 首次启动不会联网下载 Node。

Production Runtime Payload 来自干净的 production dependency install 和已经构建的 ChatCockpit 产物，不会直接复制贡献者开发机当前的完整 `node_modules`。

## 构建本地 unsigned App

从源码构建 `.app` 本身仍然需要仓库开发工具链：

```bash
npm ci
npm run verify:runtime-manifest
npm run verify:distribution-context
swift test --package-path desktop/macos
npm run build:macos-desktop -- --arch arm64
```

构建 Intel 包时使用 `--arch x64`。

输出：

```text
dist/macos/ChatCockpit.app
```

App 内包含：

```text
Contents/MacOS/ChatCockpit
Contents/Resources/TokenPilotRuntime/
```

本地 Swift、Xcode 与 Distribution 三条构建链都会向 App Bundle 写入 public-safe 的构建来源信息：基于时间的 Build ID、源码 Git revision 与构建时间。原生 App 的概览/更新界面会直接显示这些信息，因此即使两个包的营销版本都叫 `0.2.0`，也能立即判断是不是同一构建。Runtime 的 `/api/health` 也会独立投影 Runtime package version、Build ID、revision 与 build timestamp，用于直接识别 App/Runtime 版本漂移。

当前构建仍然明确是 **unsigned / unnotarized**。构建命令会直接输出：

```text
signing: not performed
notarization: not performed
```

因此不能把它描述成已签名的正式 macOS 公开发行版。

## Packaged Mode 首次启动

打开本地构建：

```bash
open dist/macos/ChatCockpit.app
```

只要 App 中存在合法的 Runtime Payload，Packaged Mode 就可用。App 的 **项目** 页面是 Machine Authority 下管理本机 Project Registry 的主入口：可从本机目录创建 Project、附加 Project Root、变更 **Primary Root**，以及仅解除 Registry 关联而不删除磁盘文件。普通非 Git 目录仍可以成为 Project Root，但不会伪装成可执行 checkout。

Git Project Root 可以拥有带稳定本地 `repoId` 的 **Execution Workspace**。Project 的 Primary Root 与 Runtime 当前选择/默认的 Execution Workspace 是相关但不同的概念：变更 Primary Root 不会静默重写仍然有效的执行选择，非 Git Primary Root 也不能变成 Execution Workspace。项目目录授权变化绝不会自动启动、停止或重启 Runtime；运行中的服务只有经过显式生命周期动作才会改变状态。

App 会校验内嵌 Runtime，并通过 staging → verify → atomic promote 的方式部署到 Application Support。新的 Payload 如果损坏或部署失败，不会覆盖此前已经有效的 Runtime。

工作区集合以 ChatCockpit 私有配置为 canonical 真源；macOS 用户偏好只缓存当前主工作区选择。机器绝对路径不会提交到公共仓库。

真实启动、Developer Mode、Packaged Mode conflict guard 与 standalone Packaged Runtime 的可重复验收步骤见 [`../testing/macos-desktop-smoke.md`](../testing/macos-desktop-smoke.md)。

## Import Existing Setup

Packaged Mode 提供显式 **Import Existing Setup…** 操作。

导入流程默认非破坏：

- Source checkout 只读；
- 应用前先展示 Preview；
- 可导入 Workspace allowlist / repo mapping 与安全的本地 endpoint 设置；
- 不迁移 API bearer token；
- 不迁移 OAuth access / refresh token；
- 不迁移 Process Supervisor token；
- 不迁移 provider credential 或 cookie。

如果原 Source Setup 开启了 exposed mode，导入后的 Packaged Setup 会安全恢复为 **Local only**，待用户重新显式确认公网地址与本机权限状态后再开启公网模式。机器 API bearer 仍然只是 CLI/自动化等机器客户端的可选凭据，并不是控制台管理员会话或 ChatGPT OAuth 的前置条件。

## Runtime 冲突保护

Source Mode 与 Packaged Mode 使用 canonical ChatCockpit LaunchAgent service identity。因此，在允许 Packaged Mode 执行服务变更之前，Desktop App 会检查已安装 LaunchAgent 的 ownership。

如果检测到以下任一情况：

- 现有 Developer Mode Runtime；
- 另一份 Packaged Runtime；
- ownership 无法识别的 ChatCockpit LaunchAgent；
- 已有其他进程占用了配置端口；

Packaged Mode 会进入冲突提示状态，并且**不会自动**：

- 停掉旧 Runtime；
- Restart 旧 Runtime；
- 替换旧 LaunchAgent plist；
- 杀掉 foreign listener；
- 接管旧 service identity。

用户需要先在现有 Runtime 所属模式中显式处理它，再刷新 Packaged Mode。

同样的 ownership 边界也下沉到了 lifecycle shell，因此绕过 GUI 直接调用 packaged lifecycle，也不会把它变成自动接管 Source Runtime 的通道。

## Runtime 状态

Desktop Shell 继续呈现四个整体状态：

- **Setup Required**：缺少必要 Workspace/Runtime 输入，或选中的 Runtime 无效；
- **Stopped**：设置合法，但 Control Plane 尚未运行；
- **Needs Attention**：Runtime 只有部分组件正常；
- **Ready**：当前 Node Runtime 合法、Control Plane running、Runner registered、Process Supervisor ready、`/api/health` 返回 `ok: true`，并且当前配置的控制台安全入口可达。

Runtime Conflict 是独立于上述四态的保护信号：即使某个进程本身可达，只要 ownership 不属于当前 Packaged Runtime，Desktop 也不会因为“端口有人监听”就允许 mutation。

## Start / Stop / Restart

Swift 层不会重写 LaunchAgent 管理，而是继续复用：

```text
scripts/macos-manage-local-server.sh
```

Desktop 只开放：

```text
status
start
stop
restart
```

Lifecycle Helper 管理：

- `com.wuaishare.chatcockpit.control-plane`；
- `com.wuaishare.chatcockpit.runner`；
- `com.wuaishare.chatcockpit.process-supervisor`。

Packaged Mode 会显式向这条 lifecycle contract 传入 Install Root、State Root、当前用于 bootstrap 的 Execution Workspace、Bundled Node 绝对路径与 Distribution Mode。LaunchAgent 使用 bundled Node 的绝对路径，不再依赖 `command -v node`。

普通 Restart 继续保持既有 Process Supervisor generation 语义。

## Quit 不等于 Stop

**Quit ChatCockpit** 只退出原生 GUI。

它不会隐式停止 Control Plane、Runner 或 Process Supervisor。只有明确希望停止当前 Runtime 所拥有的 ChatCockpit 服务栈时，才使用 **Stop Services**。

## Open ChatCockpit

Cockpit 可达时，**Open ChatCockpit** 仍通过系统默认浏览器打开现有 Web UI：

```text
http://<configured-host>:<configured-port><console-path>
```

全新初始化会随机生成 `<console-path>`。请优先使用 App 的 **打开本机控制台**，或读取 lifecycle status 输出中的 `UI:` 地址，不要再假定固定 `/ui`。

Desktop 不内嵌，也不重写完整 Cockpit。状态页中的本机/公网控制台地址使用原生可点击链接，鼠标悬浮显示手型指针，并支持键盘焦点与 VoiceOver 标签/提示；**安全与访问** 还会显示可复制的本机/公网 API 与 MCP 地址，供机器客户端使用。

## 安全边界

原生壳层继续让现有 ChatCockpit 安全模型保持权威：

- 机器 API 令牌默认只显示指纹；只有用户明确操作时才会在内存中短时显示明文，复制操作也必须由用户主动触发并在安全条件下自动清理剪贴板；
- **安全与访问** 会把本机/公网 API 基址和 MCP 端点与令牌分开显示，并提供明确的复制按钮；
- 从 App 打开 **本机控制台** 时，可使用仅 45 秒有效且只能使用一次的 loopback 登录凭据换取现有 HttpOnly 管理员 Session，无需再次输入密码；该入口拒绝反向代理和非 loopback 请求，不降低公网认证强度；
- 通用密钥在 Web 控制台中管理，并作为公网 HTTPS 地址的首选认证方式；WebAuthn 也允许 `http://localhost` 用于本机测试，但默认 App 使用的 `127.0.0.1` 直接 IP 不是合法 WebAuthn RP ID，因此这里刻意继续使用原生一次性免密解锁；
- Existing Setup Import 不复制 secret；
- 不创建第二套 OAuth；
- 不绕过 Approval 或 Mutation Policy；
- 不新增 Remote MCP 权限；
- 不提供任意 shell command 输入框；
- Packaged Runtime / State / Workspace 根保持分离；
- Payload hash 可以发现 Runtime 损坏，但在 App 尚未签名时不能冒充 publisher authenticity 证明。

## Phase 2 验证

主要门禁包括：

```bash
npm run verify:runtime-manifest
npm run verify:distribution-context
npm run verify:packaged-doctor
swift test --package-path desktop/macos
npm run build:macos-runtime -- --arch arm64
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR=dist/macos-runtime/arm64/TokenPilotRuntime npm run verify:macos-runtime-payload
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR=dist/macos-runtime/arm64/TokenPilotRuntime npm run verify:packaged-runtime
npm run build:macos-desktop -- --arch arm64
npm run verify:macos-desktop
```

`verify:packaged-runtime` 是 live proof，必须使用 CI/本机 runner 的原生架构。它会刻意隐藏 system Node/npm，使用 bundled Node 启动 Packaged Control Plane，验证 health/UI/workspace，并再次确认 immutable runtime hash 未改变。

同一 runner 上可以构建另一架构并做静态 Payload 校验，但 arm64 runner 上的 x64 静态校验不会被描述成 Intel-native live execution，反之亦然。

## Phase 3 分发工程状态

Phase 3 Secretless Distribution Engineering 现在已经建立在 Phase 2 Runtime 之上，新增 Development DMG 验证、Trust-aware Release Metadata 与显式 Manual Verified Update，同时把正式生产认证继续保留为独立的未来 Gate。

Development Artifact 仍然不是 Production Release，也永远不能直接标记为 Release Eligible。Settings 中的更新检查只由用户显式触发，Download Update 不会静默替换 App，也不会自动重启 ChatCockpit 服务。

当前分发状态、DMG 流程、Release Manifest 信任规则、Manual Verified Update 行为与延后的 Production Certification Boundary，见 [`macos-release.md`](./macos-release.md)。
