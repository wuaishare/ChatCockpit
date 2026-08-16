# macOS Desktop Smoke Test

本文用于真实启动和验收 `ChatCockpit.app`，重点区分 **Developer Mode** 与 **Packaged Mode** 的 ownership 边界。

## 当前本地构建

从源码构建后，App 位于：

```text
dist/macos/ChatCockpit.app
```

启动：

```bash
open dist/macos/ChatCockpit.app
```

正常情况下会立即出现 **ChatCockpit 状态** 主窗口，Dock 中可见 ChatCockpit，同时菜单栏保留 ChatCockpit 状态项。Desktop 默认跟随 macOS 的系统/单独应用语言设置；当前完整支持简体中文与 English。关闭主窗口不会停止 Runtime，App 仍可从 Dock 或菜单栏重新进入。

如果还没有本地 App，可构建当前架构：

```bash
npm ci
npm run build:macos-desktop -- --arch arm64
```

Intel Mac 使用 `--arch x64`。

当前 development App 仍是 unsigned / unnotarized，不应描述为正式公开 macOS 发行版。

## 1. Developer Mode — 推荐的维护者首测路径

如果当前 Source Runtime 已经通过 `npm run mvp:start` / `npm run start:local` 运行，优先使用 Developer Mode。首次启动时，只要 ChatCockpit 能发现合法 source checkout，就会自动选择 Developer Mode；用户之后手动选择的 Developer/Packaged Mode 会被记住。

1. 启动 `ChatCockpit.app`；
2. 确认主窗口没有裁切，底部 **Refresh / Settings… / Runtime actions / Open ChatCockpit** 始终可见；
3. 如果已自动发现 source checkout，确认 Distribution 为 **Developer**；否则打开 Settings，选择 **Developer Mode** 并点击 **Choose Source…**；
4. 如需手动选择，选择当前 ChatCockpit source checkout；
5. 点击 **Revalidate**；
6. 确认 Runtime 状态为 **Ready**；
7. 确认 Endpoint 为 `127.0.0.1:4318`（除非你明确配置了其他本地 endpoint）；
8. 确认 State 显示全局 `~/.chatcockpit`，而不是 checkout-local state；
9. 在 **安全与访问** 中确认 Web Owner 状态与机器 API 令牌分开显示。机器令牌默认只能显示指纹（例如 `cc_local_…abc123`），不能直接暴露明文；
10. 确认 **显示令牌** 只有在用户明确操作后才临时显示明文，并会自动再次隐藏；**复制令牌** 也只能由用户主动触发。普通 smoke test 不要轮换真实令牌；
11. 确认 **设置 / 管理 Owner…** 可修改 Owner 用户名与密码，**撤销 Web 会话** 可独立撤销现有会话，且不会暴露密码或 Session Secret；
12. 点击 **Open ChatCockpit**，应使用默认浏览器打开 Web Cockpit。

Source/Developer Mode 的 canonical state root 是：

```text
~/.chatcockpit
```

它与源码 checkout 分离。

### 安全与访问边界

Desktop App 是这台 Mac 上的人类 Web Owner 与机器 API 凭据管理入口，但仍复用 Runtime 的 canonical authority 真源，不建立第二套凭据数据库。

- 修改 Web Owner 用户名/密码继续使用现有 Operator Service，并会撤销已有 Web Session；
- 机器 API 令牌默认隐藏；只有明确执行“显示”时才进入内存，并会在 30 秒后自动清除；复制到系统剪贴板的令牌会在 60 秒后自动清除，但仅当剪贴板仍保持该令牌时才执行，避免覆盖用户之后复制的新内容；
- 轮换令牌会在 canonical `server.env` 中生成新的强随机令牌，并保持文件仅当前用户可读写；不会改动 Web Owner 或 ChatGPT OAuth authority；
- 如果服务正在运行，轮换后会重启当前 Runtime 使新令牌生效；如果服务已停止，则保持停止，并在下次启动时读取新令牌；
- ChatGPT OAuth Client / Authorization 仍由 Web Integrations 管理，不把远端集成关系塞进 Desktop Secret 管理面。

## 2. Packaged Mode Conflict Guard

当 Developer Mode 的 ChatCockpit LaunchAgents 正在运行时，不要期待 Packaged Mode 自动接管。

测试：

1. 保持 Developer Mode services 运行；
2. 在 App Settings 切到 **Packaged Mode**；
3. 点击 **Choose Workspace…**，选择一个真实项目目录；
4. Refresh / Revalidate；
5. 应看到 **Runtime Conflict**，说明 Developer Mode 已拥有当前 ChatCockpit service identity。

通过标准：

- Packaged Mode 不会自动 stop/restart Developer Mode；
- 不会替换 LaunchAgent plist；
- 不会因为 `4318` 有健康 listener 就宣称自己拥有它；
- UI 明确告诉用户先在当前 owner mode 中处理冲突。

这是安全特性，不是启动失败。

## 3. Packaged Mode Standalone Test

这个测试会切换本机 Runtime owner，建议在明确的维护窗口执行。

### 3.1 停止 Developer Mode

在 source checkout：

```bash
npm run mvp:stop
```

确认三个 Source services 已停止后再继续。

### 3.2 启动 Packaged Mode

1. 打开 `ChatCockpit.app`；
2. Settings → **Packaged Mode**；
3. **Choose Workspace…** 选择测试项目；
4. App 校验并部署内嵌 Runtime Payload；
5. 点击 **Start Services**；
6. 等待状态进入 **Ready**；
7. 点击 **Open ChatCockpit**；
8. 验证 Web UI、health、Workspace mapping 与基础只读操作。

Packaged Mode 使用独立路径：

```text
~/Library/Application Support/ChatCockpit/runtimes/
~/Library/Application Support/ChatCockpit/state/
~/Library/Application Support/ChatCockpit/config/
```

它不会把 Runtime 目录当作用户 Workspace。

## 4. Import Existing Setup

如果希望把 Source Setup 的安全配置迁给 Packaged Mode：

1. Settings → Packaged Mode；
2. 点击 **Import Existing Setup…**；
3. 先看 Preview；
4. 确认后再 Apply。

Import 只迁移可安全复用的 Workspace mapping 和非秘密本地设置。

不会迁移：

- API bearer token；
- OAuth access/refresh token；
- Process Supervisor token；
- provider credential / cookie。

如果 Source Setup 是 exposed mode，导入后 Packaged Mode 会安全回到 Local only，直到你重新显式配置凭据。

## 5. Stop / Restore Developer Mode

完成 Packaged smoke 后：

1. 在 App 中点击 **Stop Services**；
2. 切回 **Developer Mode**；
3. 选择当前 ChatCockpit checkout；
4. 可以从 App 点击 Start，或在 source checkout 执行：

```bash
npm run mvp:start
```

5. 确认 Developer Mode 再次 Ready。

## 6. Quit 与 Stop 的区别

**Quit ChatCockpit** 只退出 SwiftUI GUI，不会停止后台 Control Plane、Runner 或 Process Supervisor。

只有明确希望停止当前模式拥有的服务栈时才使用 **Stop Services**。

## 7. Smoke Test 通过标准

- App 可以正常启动；
- Developer Mode 能识别 canonical Source runtime；
- `~/.chatcockpit` 是 Source state root；
- Packaged Mode 能识别 Developer ownership conflict；
- Packaged Mode 不会越权接管现有 services；
- 独立 Packaged Runtime 能在不依赖 system Node 的情况下启动；
- Web Cockpit 可从 App 打开；
- 机器 API 令牌默认不显示明文，只有用户明确执行临时显示/复制时才允许读取；
- Web Owner 与机器 API authority 保持独立管理；
- Quit 不会偷偷 Stop Services。
