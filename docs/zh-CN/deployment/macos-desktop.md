# ChatCockpit Desktop for macOS

ChatCockpit Desktop 是现有 ChatCockpit Node Control Plane 之上的原生 SwiftUI 操作壳层。Phase 2 在保持 Node/TypeScript Control Plane、Runner、Process Supervisor、Web Cockpit、MCP、OAuth、Continuity、Codex、Approval 与 Resource Center 单一业务真源的前提下，加入了 Self-contained Packaged Runtime。

## Phase 2 当前边界

Desktop App 现在明确支持两种运行模式。

### Packaged Mode

Packaged Mode 是普通桌面使用场景的 Self-contained 路径：

- `.app` 自带经过校验的 ChatCockpit Runtime Payload；
- Payload 内置当前 macOS 架构对应的精确 Node.js `24.18.1`；
- 首次使用时把内嵌 Payload 部署到 `~/Library/Application Support/ChatCockpit/runtimes/` 下的版本化 Runtime；
- 可写 ChatCockpit 状态独立放在 `~/Library/Application Support/ChatCockpit/state/`；
- 本机私有配置独立放在 `~/Library/Application Support/ChatCockpit/config/`；
- 用户选择 ChatCockpit 真正要操作的项目 Workspace；
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

## Runtime 与 Workspace 分离

Packaged Mode 明确区分四种根：

```text
ChatCockpit.app
├── Contents/Resources/TokenPilotRuntime/       App 内只读 Runtime Payload（内部实现目录名）

~/Library/Application Support/ChatCockpit/
├── runtimes/<runtime-id>/                      部署后的 immutable Runtime
├── state/                                      可写本机 Runtime State
└── config/                                     本机私有配置

<用户选择的项目>/                               ChatCockpit 真正操作的 Workspace
```

部署后的 Runtime 与 Application Support State 不会自动加入 Workspace allowlist。

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

只要 App 中存在合法的 Runtime Payload，Packaged Mode 就可用。用户只需要选择 ChatCockpit 真正要操作的项目目录。

App 会校验内嵌 Runtime，并通过 staging → verify → atomic promote 的方式部署到 Application Support。新的 Payload 如果损坏或部署失败，不会覆盖此前已经有效的 Runtime。

所选 Workspace 只存于本机 macOS 用户偏好与 ChatCockpit 私有配置中，不会把机器绝对路径提交到公共仓库。

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

如果原 Source Setup 开启了 exposed mode，由于 bearer credential 明确不复制，导入后的 Packaged Setup 会安全恢复为 **Local only**。只有重新显式配置 Packaged credential 后，才应该重新打开 exposed mode。

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
- **Ready**：当前 Node Runtime 合法、Control Plane running、Runner registered、Process Supervisor ready、`/api/health` 返回 `ok: true`，并且 `/ui` 可达。

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

Packaged Mode 会显式向这条 lifecycle contract 传入 Install Root、State Root、Primary Workspace、Bundled Node 绝对路径与 Distribution Mode。LaunchAgent 使用 bundled Node 的绝对路径，不再依赖 `command -v node`。

普通 Restart 继续保持既有 Process Supervisor generation 语义。

## Quit 不等于 Stop

**Quit ChatCockpit** 只退出原生 GUI。

它不会隐式停止 Control Plane、Runner 或 Process Supervisor。只有明确希望停止当前 Runtime 所拥有的 ChatCockpit 服务栈时，才使用 **Stop Services**。

## Open ChatCockpit

Cockpit 可达时，**Open ChatCockpit** 仍通过系统默认浏览器打开现有 Web UI：

```text
http://<configured-host>:<configured-port>/ui
```

本地默认仍为：

```text
http://127.0.0.1:4318/ui
```

Desktop 不内嵌，也不重写完整 Cockpit。

## 安全边界

原生壳层继续让现有 ChatCockpit 安全模型保持权威：

- 不显示 bearer token 值；
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
