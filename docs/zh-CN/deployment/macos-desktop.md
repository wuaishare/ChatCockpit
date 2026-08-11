# TokenPilot Desktop for macOS

TokenPilot Desktop Phase 1 是现有本地 TokenPilot Runtime 之上的原生 SwiftUI 操作壳层。它不会替代 Node Control Plane、Runner、Process Supervisor、Web Cockpit、MCP、OAuth、Continuity、Codex、Approval 或 Resource Center。

## Phase 1 当前边界

Phase 1 提供：

- macOS 原生菜单栏状态入口；
- 紧凑的 Status 状态窗口；
- 原生 Settings 设置窗口；
- TokenPilot Root 有界自动发现与手动目录选择；
- 本地 Node Runtime 校验；
- 复用现有 macOS 生命周期脚本的 Start / Stop / Restart；
- 本地 Health 与 Cockpit 可达性状态；
- `Open TokenPilot`，通过默认浏览器打开现有 `/ui`；
- 可在本机构建验证的 unsigned `.app`。

Phase 1 **不包含**：

- 内置 Node；
- Developer ID 签名；
- Apple notarization；
- `.dmg` 正式分发；
- 自动更新；
- 把 Web Cockpit 或 TokenPilot 业务逻辑重写成原生版本。

## 环境要求

当前 Phase 1 源码构建要求：

- macOS 14 或更高版本；
- 可构建该 Swift Package 的 Apple Swift Toolchain；
- 现有 TokenPilot Runtime 所需的 Node.js `>=22.13.0`；
- 一个合法的 TokenPilot 源码或已构建 checkout。

Desktop App 会真正校验所选 Root，而不是只看目录名。合法 Root 必须包含 TokenPilot `package.json`、现有 macOS lifecycle script，并且具有源码 CLI 或构建后的 CLI 入口。

## 构建本地 unsigned App

在 TokenPilot 仓库根目录执行：

```bash
npm ci
npm run verify:macos-desktop
swift test --package-path desktop/macos
npm run build:macos-desktop
```

生成：

```text
dist/macos/TokenPilot.app
```

该 App 当前明确是 unsigned / unnotarized 本地构建；构建命令也会直接打印这一限制。

## 首次启动

```bash
open dist/macos/TokenPilot.app
```

App 会先执行有界的 TokenPilot Root 发现。找不到合法 Root 时，可从菜单栏或 Settings 手动选择。

所选 Root 只保存在本机 macOS 用户偏好中，不写入公共仓库。

## Runtime 状态

Desktop Shell 对外只呈现四个整体状态：

- **Setup Required**：没有合法 TokenPilot Root，或缺少/不支持所需 Node Runtime；
- **Stopped**：本地设置合法，但 Control Plane 没有运行；
- **Needs Attention**：Runtime 只有部分组件正常；
- **Ready**：Node 满足要求、Control Plane running、Runner registered、Process Supervisor ready、`/api/health` 返回 `ok: true`，且 `/ui` 可达。

App 不会因为“某个进程存在”就宣布 Ready。

## Start / Stop / Restart

Swift 层不会重写 LaunchAgent 管理逻辑，而是继续复用唯一生命周期合同：

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

继续沿用三个服务的现有语义：

- `com.wuaishare.tokenpilot.control-plane`；
- `com.wuaishare.tokenpilot.runner`；
- `com.wuaishare.tokenpilot.process-supervisor`。

特别是 Restart 继续保持现有 Process Supervisor generation 语义，不在 Swift 里制造第二套重启规则。

## Quit 不等于 Stop

**Quit TokenPilot** 只退出原生 GUI。

它不会隐式停止 Control Plane、Runner 或 Process Supervisor。

只有显式点击 **Stop Services** 才停止本地 TokenPilot 服务栈。这避免用户只是关闭菜单栏工具，却意外终止正在持续运行的受管理任务。

## Open TokenPilot

本地 Cockpit 可达时，**Open TokenPilot** 打开：

```text
http://<configured-host>:<configured-port>/ui
```

常见本地默认地址：

```text
http://127.0.0.1:4318/ui
```

Phase 1 使用系统默认浏览器打开现有 Web Cockpit，不内嵌 WebView，也不复制一套原生 Cockpit。

## 安全边界

Desktop Shell 继续让现有 TokenPilot 安全模型保持权威：

- 不显示 bearer token 值；
- 不创建第二套 OAuth；
- 不绕过 Approval 或 Mutation Policy；
- 不新增 Remote MCP 权限；
- 不自动打开 exposed mode；
- 不提供任意 shell command 输入框。

Settings 可以显示 local/exposed、API token 是否已配置等安全状态，但 secret 值保持隐藏。

## 验证

```bash
npm run verify:macos-desktop
swift test --package-path desktop/macos
npm run build:macos-desktop
```

GitHub CI 还包含独立的 `macOS desktop package` job，与 Node 22/24 双矩阵分开验证 Desktop Package。

## 后续 Packaging

后续阶段继续独立推进：

1. bundled Node / self-contained runtime；
2. 完整 Xcode distribution pipeline；
3. Developer ID + hardened runtime；
4. Apple notarization；
5. `.app` / `.dmg` release workflow；
6. update strategy。

在这些门禁完成前，不把 Phase 1 本地 unsigned build 描述成已签名或已公证的正式发行版本。
