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

正常情况下会立即出现唯一的 **ChatCockpit** 主窗口，左侧导航包含 **概览 / 运行环境 / 工作区 / 访问与安全 / 集成 / 更新 / 诊断**；Dock 中可见 ChatCockpit，同时菜单栏保留 ChatCockpit 状态项。**概览**承担高密度本机摘要：整体状态、Control Plane / Runner / Process Supervisor 健康度、authoritative 本机活动计数、本机/公网控制台访问、访问与安全摘要、运行环境信息、App 版本与更新状态。活动数据来自 machine-local、只读的 `desktop-summary` 投影，包括运行任务、排队任务、保留的失败记录和真正待人工决策的待审批；某个数据源不可读取时必须显示 **— / 不可用**，绝不能伪造 0。失败记录是保留的历史 failed Job，不应渲染成“Runtime 当前正在故障”。Desktop 默认跟随 macOS 的系统/单独应用语言设置；当前完整支持简体中文与 English。关闭主窗口不会停止 Runtime，App 仍可从 Dock 或菜单栏重新进入。系统 **设置…** 只保留 App 自身偏好入口，不再复制 Runtime、Workspace 或 Security 运维界面。

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
2. 确认主窗口没有裁切，侧栏 7 个运维入口都可键盘/鼠标访问；**概览**顶部的“刷新”是一级操作，底部 Runtime 生命周期操作栏持续可见。“运行环境健康”卡片用**文字 + 图标 + 语义颜色**同时表达 Control Plane / Runner / Process Supervisor 状态，不能只靠颜色。**活动**卡片必须从只读 native-safe summary 展示运行任务 / 排队任务 / 失败记录 / 待审批；数据源不可用时显示 **— / 不可用**，失败记录使用 warning/history 语义而不是 active-failure danger 语义。**本机控制台 / 公网控制台**必须显示真实地址，并在地址同行提供 **复制 / 在浏览器中打开** 两枚图标动作；图标动作需要手型指针、键盘焦点、Tooltip/Help 与独立 VoiceOver 描述。复制成功只把当前图标短时切成“已复制”，约 2 秒后恢复，绝不能写入长期全局提示。只有 exposed 模式存在合法公网基址时才显示公网地址；在主窗口允许的最小宽度下，Overview 各卡片不能横向溢出；
3. 如果已自动发现 source checkout，确认 **运行环境** 中 Distribution 为 **Developer**；否则在 **运行环境** 中选择 **Developer Mode** 并点击 **Choose Source…**；
4. 如需手动选择，选择当前 ChatCockpit source checkout；
5. 点击 **Revalidate**；
6. 确认 Runtime 状态为 **Ready**；
7. 确认 Endpoint 为 `127.0.0.1:4318`（除非你明确配置了其他本地 endpoint）；
8. 确认 State 显示全局 `~/.chatcockpit`，而不是 checkout-local state；
9. 在 **安全与访问** 中确认控制台管理员状态与机器 API 令牌分开显示。由 Secure Bootstrap 管理的管理员必须显示随机用户名与默认掩码密码行；**复制管理员用户名 / 显示管理员密码 / 复制管理员密码** 都应是同行图标动作，并具有唯一 VoiceOver 说明。管理员密码只有明确操作后才显示，约 30 秒后自动隐藏；复制密码后若剪贴板未被用户改动，应在约 60 秒后自动清除。若是旧版遗留管理员且本机可恢复凭据与当前 Owner 版本不匹配，必须显示 **不可读取**，绝不能展示旧密码或伪造密码。机器令牌默认仍只显示指纹（例如 `cc_local_…abc123`）；**显示 / 复制 / 轮换** 保持令牌值同行。**本机 API 基址 / 本机 MCP 端点** 及公网 API/MCP 地址（如已开放）各自带同行复制图标；所有图标动作悬浮时使用手型指针、可通过键盘聚焦，并为 VoiceOver 提供独立动作说明；
10. 确认 **显示令牌** 只有在用户明确操作后才临时显示明文，并会自动再次隐藏；**复制令牌 / 复制 API 地址** 成功后只在当前图标位置短时切换为“已复制”，约 2 秒后自动恢复，不得写入主窗口的长期“提示”区域。普通 smoke test 不要轮换真实令牌；
11. 在 **访问与安全** 中确认 **设置 / 管理管理员…** 可修改管理员用户名与密码，并同步本机可恢复凭据；**撤销 Web 会话** 可独立撤销现有会话。Session Secret 始终不可恢复、不可展示；
12. 正常新状态启动时，Secure Bootstrap 应已经自动创建管理员与随机控制台入口。从 App 执行 **打开本机控制台**，应无需再次输入密码即可进入：App 生成短时一次性 loopback 登录凭据，浏览器中的 `#local-login=…` fragment 必须立即消失，最后得到的仍是普通 HttpOnly 管理员 Session；同一凭据再次兑换必须失败。管理员缺失现在属于旧状态/恢复场景：直接 macOS loopback 打开的 Web 首次设置页必须提供 **前往 ChatCockpit App 设置** 入口，且 **我已设置，重新检查** 必须显示 loading，并明确给出“仍未配置”或“检查失败”的结果，不能静默无反应。公网控制台必须继续使用配置的 HTTPS 控制台入口路径，且绝不能携带这枚本机免密凭据。

Source/Developer Mode 的 canonical state root 是：

```text
~/.chatcockpit
```

它与源码 checkout 分离。

### 安全与访问边界

Desktop App 是这台 Mac 上的人类控制台管理员与机器 API 凭据管理入口。`operator-auth.sqlite` 继续作为管理员密码哈希、Session、限流与审计状态的 authority 真源；Secure Bootstrap 额外维护一份仅 owner 可读（`0600`）的本机 credential vault，只用于让原生 App 恢复/显示自动生成的管理员密码。它不是第二套认证 authority，并且必须被 Files API、Git/public bundle、源码归档、浏览器响应、日志与 public-safe projection 排除。

- 全新初始化必须在 Control Plane 开始提供 Web 服务之前生成高熵随机控制台入口、随机管理员用户名与强密码；普通 init/start 输出不得打印这些私密值；
- 修改控制台管理员用户名/密码继续使用现有 Operator Service，并会撤销已有 Web Session，同时把可恢复 vault 与当前 Owner 版本精确绑定；vault 过期或不匹配时只能降级为 **不可读取**，不得显示已经失效的旧密码；
- 机器 API 令牌默认隐藏；只有明确执行“显示”时才进入内存，并会在 30 秒后自动清除；复制到系统剪贴板的令牌会在 60 秒后自动清除，但仅当剪贴板仍保持该令牌时才执行，避免覆盖用户之后复制的新内容；API/MCP 地址属于非敏感连接元数据，可直接复制，不需要按 secret 清理剪贴板；复制成功反馈属于局部瞬时 UI state，约 2 秒后自动清除，不能复用全局运行状态消息；
- 本机免密不是“127.0.0.1 全部绕过登录”：Desktop 本地签发 45 秒有效、只能使用一次的凭据，只有直接 loopback Web 请求能兑换为正常管理员 Session；经过代理/Forwarded Header、非 loopback Host、过期、重复使用、管理员改密后遗留、执行“撤销全部会话”后遗留的凭据都必须 fail closed；
- 轮换令牌会在 canonical `server.env` 中生成新的强随机令牌，并保持文件仅当前用户可读写；不会改动控制台管理员或 ChatGPT OAuth authority；
- 如果服务正在运行，轮换后会重启当前 Runtime 使新令牌生效；如果服务已停止，则保持停止，并在下次启动时读取新令牌；
- **访问策略**必须读取 Runtime State 中同一份 owner-only canonical `access-policy.json`：全新状态默认使用随机入口，而不是 `/ui`。随机/自定义入口生效后，App 的本机/公网控制台 URL 与 UI 探活都必须同步使用新路径；传统 `/ui` 返回 404；不知道当前安全入口的匿名管理员 status/login/Passkey 登录请求也必须返回 404。该机制属于 defense-in-depth，仍与管理员认证、登录限流、CSRF、公网 HTTPS 共同生效。Trusted LAN 只负责网络准入，不能绕过管理员认证；开启 LAN policy 也不能自动把 listener 从 loopback 扩大到局域网。
- ChatGPT OAuth Client / Authorization 仍由 Web Integrations 管理，不把远端集成关系塞进 Desktop Secret 管理面。

## 2. Packaged Mode Conflict Guard

当 Developer Mode 的 ChatCockpit LaunchAgents 正在运行时，不要期待 Packaged Mode 自动接管。

测试：

1. 保持 Developer Mode services 运行；
2. 在主窗口 **运行环境** 中切到 **Packaged Mode**；
3. 点击 **选择主工作区…**，选择一个真实项目目录；
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
2. 主窗口 **运行环境** → **Packaged Mode**；
3. **选择主工作区…** 选择测试项目；
4. 在 **工作区** 区域添加第二个测试项目，确认两个目录分别显示稳定 repo ID，且只有一个带 **主工作区** 标记；
5. 将第二个项目 **设为主工作区**，确认 App 明确提示不会自动启动/停止/重启 Runtime；再将预期项目恢复为主工作区；
6. 移除非主工作区，确认弹窗明确说明只移除 ChatCockpit 映射、不删除项目文件；
7. App 校验并部署内嵌 Runtime Payload；
8. 点击 **Start Services**；
9. 等待状态进入 **Ready**；
10. 点击 Runtime 区域中的 **本机控制台** URL；如果当前已配置并启用公网入口，再单独测试 **公网控制台** URL；
11. 验证 Web UI、health、多 Workspace mapping 与基础只读操作。

Packaged Mode 使用独立路径：

```text
~/Library/Application Support/ChatCockpit/runtimes/
~/Library/Application Support/ChatCockpit/state/
~/Library/Application Support/ChatCockpit/config/
```

它不会把 Runtime 目录当作用户 Workspace。工作区集合的 canonical 真源是 `config/config.json` 中现有的 `defaultRepoId + workspaceAllowlist + repoMappings`，不是 Desktop 自己另建一套数据库；macOS 偏好只缓存当前主工作区选择。

## 4. Import Existing Setup

如果希望把 Source Setup 的安全配置迁给 Packaged Mode：

1. 主窗口 **运行环境** → Packaged Mode；
2. 点击 **Import Existing Setup…**；
3. 先看 Preview；
4. 确认后再 Apply。

Import 只迁移可安全复用的 Workspace mapping 和非秘密本地设置。

不会迁移：

- API bearer token；
- OAuth access/refresh token；
- Process Supervisor token；
- provider credential / cookie。

如果 Source Setup 是 exposed mode，导入后 Packaged Mode 会安全回到 Local only，直到你重新显式确认公网地址与本机权限状态。机器 API 令牌仍是 CLI/自动化等机器客户端的可选凭据，不是 Web 控制台或 ChatGPT OAuth 的前置条件。

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

## 6. 菜单栏 Mini Console

在 Developer Mode 健康运行时打开 ChatCockpit 菜单栏状态项。紧凑窗口必须直接消费主 App 同一份 `DesktopAppModel` projection，不能自己推断第二套状态真相。

确认：

- 整体状态与当前 Distribution Mode 同时可见，并使用“文字 + 语义图标”，不能只靠颜色；
- Control Plane / Runner / Process Supervisor 分别展示真实 lifecycle 状态；
- 运行任务 / 排队任务 / 失败记录 / 待审批来自只读 `desktop-summary`；store 不可读时显示 `—` / **不可用**，绝不能伪造 0；
- 本机/公网控制台使用当前 canonical URL，包括随机安全入口，并在同行提供 Copy/Open；
- 复制成功只产生局部短时反馈，不能写入长期全局提示；
- 更新状态与当前 Runtime conflict/attention 无需打开主窗口即可看到；
- Ready/Degraded 提供 Stop + Restart；Stopped 提供 Start；Setup Required 提供 setup action；Refresh 与 Open ChatCockpit 始终是 bounded action；
- **诊断**打开 canonical 主 App 的诊断页面，**设置…**只打开残余 App Preferences，不得恢复第二套运维设置窗口。

普通 smoke 不要为了证明按钮存在而实际执行 Stop/Restart。四种 lifecycle 分支由静态 verifier 锁定；破坏性真实动作只在隔离 Runtime 中验收。

## 7. Quit 与 Stop 的区别

先记录 Control Plane PID，再从菜单栏 Mini Console 选择 **Quit ChatCockpit**；确认 Control Plane PID 不变，Runner / Process Supervisor 仍健康。重新启动 App 后应继续连接同一 Runtime。

**Quit ChatCockpit** 只退出 SwiftUI GUI，不会停止后台 Control Plane、Runner 或 Process Supervisor。

只有明确希望停止当前模式拥有的服务栈时才使用 **Stop Services**。

## 8. Smoke Test 通过标准

- App 可以正常启动；
- Developer Mode 能识别 canonical Source runtime；
- `~/.chatcockpit` 是 Source state root；
- Packaged Mode 能识别 Developer ownership conflict；
- Packaged Mode 不会越权接管现有 services；
- 独立 Packaged Runtime 能在不依赖 system Node 的情况下启动；
- Web Cockpit 可从 App 打开；
- 机器 API 令牌默认不显示明文，只有用户明确执行临时显示/复制时才允许读取；
- 控制台管理员与机器 API authority 保持独立管理；
- Quit 不会偷偷 Stop Services。
