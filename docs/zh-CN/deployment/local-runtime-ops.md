# 本地运行与排障

本文说明如何在本机稳定运行 ChatCockpit Control Plane、Continuity Store、Codex App Server Adapter、Runner、Durable Process Supervisor sidecar 和本地操作员 Web UI。REST/MCP、Chat Direct、显式 Codex Session 与 Continuity 已实现；Custom GPT Actions、Remote MCP 和公网 HTTPS 仍属于实验性部署面。

## 构建与启动

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

如果希望使用原生 macOS 菜单栏操作壳和本地 unsigned App，请参阅 [`macos-desktop.md`](./macos-desktop.md)。

除非特别说明，本文命令描述的是 **Developer / Source Mode**。macOS Packaged Mode 继续复用同一套 Node/TypeScript Runtime 实现，但使用内置 Node `24.18.1`，把 Runtime / State / Config 部署到 Application Support，并让用户单独选择真实项目 Workspace。Packaged Mode 运行时不要求系统 Node/npm，也不要求 ChatCockpit checkout。

macOS 上 `start:local` 会把三项 LaunchAgent 作为一个**可停止的本地 Runtime 运行栈**统一管理：

- `com.wuaishare.chatcockpit.control-plane`
- `com.wuaishare.chatcockpit.runner`
- `com.wuaishare.chatcockpit.process-supervisor`

Device Agent 属于独立的管理平面 LaunchAgent：

- `com.wuaishare.chatcockpit.device-agent`

它使用 `./scripts/macos-manage-device-agent.sh` 单独管理，并要求设备已经完成 enrollment、存在 `device-agent.json`。启动这个服务不会创建或重置设备身份；卸载服务也会保留设备身份状态。Runtime 的 `stop` / `restart` / `reset` 不会 bootout Device Agent，这样后续即使 Runtime 已停止，远端仍有独立管理通道可以接收 Start。

异步 Job 需要 Runner 消费队列；Chat Direct 与 Codex Session 可以直接使用 Control Plane，不需要等待某个排队 Job 被 Runner 领取。Process Supervisor 独立持有 Durable Managed Process runtime；普通 `restart` 会重启 Control Plane / Runner，但会保留当前 Process Supervisor generation，而不是静默替换它。Device Agent 则完全位于这组三项 Runtime 生命周期边界之外。

## 本地配置文件

Developer Mode 推荐把运行配置放在：

```text
~/.chatcockpit/runtime/server.env
```

Packaged Mode 的等价私有配置位于 ChatCockpit Application Support State Root，不会写进所选项目 Workspace。不要为了迁移旧环境而手工复制 Source Mode secret；Desktop 的 Existing Setup Import 明确不会迁移 bearer/OAuth/provider 等凭据。

本地模式示例：

```bash
CHATCOCKPIT_EXPOSED=false
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
```

GPT Actions 模式示例：

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-token
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

占位域名只用于文档。真实域名、token、tunnel token 和机器路径不要提交到 Git。

## Web UI

Web Cockpit 现在使用独立的人类**控制台管理员**账户，不再把 `CHATCOCKPIT_API_TOKEN` 保存或复用成浏览器登录凭据。内部权限角色仍使用协议值 `owner`，但中文用户界面与文档统一称为“控制台管理员”。

首次 `init/setup` 会自动生成随机控制台管理员用户名、强随机密码和高熵随机控制台安全入口。普通初始化输出不会打印这些值。macOS App 的 **访问与安全** 是首选凭据管理面：可以查看/复制自动生成的用户名与密码，也可以重设密码。纯 CLI 恢复仍可使用：

```bash
chatcockpit operator credentials --json
chatcockpit operator set-password
```

`operator credentials` 是显式本机 secret-read 操作；不要把输出转存到日志、工单或仓库。交互式 `set-password` 会隐藏密码输入，修改管理员密码会撤销已有 Web Session，并同步本机 owner-only credential vault。受控自动化和测试可使用 `--password-stdin`，不要把密码直接写进命令行参数。

启动后不要假定固定 `/ui`，优先从 App 打开 **本机控制台**，或执行 `npm run mvp:status` 并使用其中 `UI:` 显示的当前安全入口。

浏览器以控制台管理员身份登录后获得 opaque HttpOnly Session Cookie；Web 写操作还必须提供与该 Session 绑定的 CSRF Token。原始 Web Session Secret 和机器 API Token 都不会写入浏览器持久化存储。`localStorage` 只用于保存非敏感的界面语言偏好。

### 通用密钥优先登录

首次通过密码创建并登录控制台管理员后，可进入 **安全 → 通用密钥** 注册 Passkey。ChatCockpit 使用标准 WebAuthn discoverable credential，强制 `userVerification=required`，默认不要求设备 attestation 信任。Touch ID、Apple 密码/iCloud 钥匙串、Chrome/Google Password Manager、兼容硬件安全密钥以及其他浏览器/系统认证器都通过标准 WebAuthn 接入。ChatCockpit 只保存凭据公钥、签名计数器、传输/设备元数据、RP/Origin 绑定、名称和时间戳；私钥始终留在认证器或密码管理器中。

在支持 WebAuthn 的访问地址上，通用密钥是首选网页登录方式，密码保留为备用/恢复凭据。通用密钥校验成功后签发的仍然是同一套 opaque HttpOnly 控制台管理员 Session 与 CSRF 边界，不建立第二类长期浏览器令牌。

访问地址规则刻意保持严格：

- 公网控制台：必须是配置好的 HTTPS 域名；
- 本机 WebAuthn 开发/测试：允许 `http://localhost:<端口>`；
- `127.0.0.1` 等直接 IP Host 不是合法 WebAuthn RP ID，因此不提供通用密钥入口；
- 同一台 Mac 上默认仍推荐从原生 App 打开 `127.0.0.1` 本机控制台，由一次性本机凭据免密解锁。

注册、查看和移除通用密钥都要求真实控制台管理员 Session，写操作同时要求 CSRF。机器 API Bearer 与 ChatGPT OAuth 都不能越权管理通用密钥。WebAuthn challenge 短时有效且只能使用一次；管理员改密或执行“撤销全部会话”会废弃尚未完成的 challenge，但不会删除已经注册的通用密钥。

### 密码备用登录的 TOTP 与恢复码

**安全**面板还提供可选的 TOTP 双重认证，但它只作用于“密码备用登录”这一条路径。通用密钥继续作为首选的抗钓鱼登录方式，成功使用 Passkey 后**不会**再额外要求 TOTP；macOS App 的 direct-loopback 一次性免密解锁属于 Machine Authority，同样不叠加密码 TOTP。

启用 TOTP 采用两阶段注册：ChatCockpit 先生成 machine-local 设置密钥，管理员把它加入兼容验证器，然后必须输入一次有效的 6 位动态验证码后才真正启用。TOTP 共享密钥只保存在 owner-only（`0600`）的 `operator-mfa.json`；Files 读写 API、公开 Repo Bundle、源码归档、Git public-safety 路径、浏览器状态投影以及 Audit Details 都明确禁止读取或携带该文件。`operator-auth.sqlite` 只保存 MFA 状态、短时哈希登录 challenge、最后已接受的 TOTP time-step，以及恢复码哈希。

启用后，正确的用户名/密码**不会直接签发 Web Session**，只会产生一个 5 分钟有效并绑定客户端上下文的第二因素 Challenge。必须再提交当前 TOTP 或一枚未使用的恢复码，ChatCockpit 才会签发原本那套普通 HttpOnly 管理员 Session。TOTP 允许有限的时钟偏差，但同一个已经接受的 time-step 不能重放；Challenge 本身只能使用一次，并会在连续错误达到上限后失效。第二因素失败也会累计到现有 source-level 登录退避；仅通过密码第一阶段不会清除这份失败历史，只有完整 password+TOTP、未启用 TOTP 时的完整密码登录、Passkey 或本机一次性免密解锁真正成功后，才会清除对应 source 的退避状态。

每次启用或重新生成时都会创建 10 枚高熵恢复码。明文只在当次已认证的“安全”界面返回一次，持久层只保存不可逆哈希；每枚恢复码首次使用后即原子作废。重新生成会让旧恢复码全部失效。停用 TOTP 或重新生成恢复码都必须用当前 TOTP / 未使用恢复码进行 step-up 校验，并撤销除当前安全管理 Session 之外的其他管理员 Session，从而既收紧已有会话，又保证新恢复码能够可靠交付给当前用户。

当 macOS App 打开 **本机控制台** 且已配置控制台管理员时，Desktop 会通过本机 CLI 生成一个仅 45 秒有效、只能使用一次的本机登录凭据。浏览器只会在 URL fragment 中收到它，前端会立即清除 fragment，再通过仅允许直接 loopback 请求访问的 `/api/operator/local-login` 将它兑换成同一套普通 HttpOnly 管理员 Session。它只是便捷解锁，不是“localhost 全部免鉴权”：经过反向代理/Forwarded Header 的请求、非 loopback Host 都无法使用该兑换入口，公网控制台仍必须走正常认证。

以下用 `<安全入口>` 表示当前 `access-policy.json` 中的随机 `consolePathPrefix`：

- `<安全入口>`：Dashboard / Setup Wizard
- `<安全入口>/continuity/projects`：Project、Workspace、Writer Lease 与 Git
- `<安全入口>/continuity/tasks`：真实 Task 状态
- `<安全入口>/continuity/sessions`：Chat Direct、Codex Session、Async Agent Session
- `<安全入口>/continuity/handoffs`：Prepare、Accept、Fork、Cancel
- `<安全入口>/continuity/evidence`：Evidence Checklist 与保守验证状态
- `<安全入口>/continuity/approvals`：待处理 Runtime Approval
- `<安全入口>/integrations`：本机/公网入口、ChatGPT App / MCP、API/OpenAPI 与 Custom GPT Actions 兼容信息
- `<安全入口>/gpt-helper`：0.2.x receive-only 兼容路由，会跳转到 `<安全入口>/integrations`
- `<安全入口>/jobs`：Jobs、Artifacts、进程控制

受保护的 Web 数据仍要求有效的控制台管理员会话；macOS App 可以用短时一次性 loopback 凭据引导生成同一套会话，支持的 HTTPS/localhost 地址也可以在通用密钥验证成功后签发同一套会话。机器 Bearer 继续只服务 API / 自动化兼容客户端，不再作为人类网页登录凭据。

## 访问策略：自定义控制台入口与可信局域网

ChatCockpit 把非敏感的访问策略保存在 Runtime State 的 `runtime/access-policy.json`。Developer Mode 对应 `~/.chatcockpit/runtime/access-policy.json`；Packaged Mode 使用自己的 Packaged State Root。推荐优先通过 macOS App 的 **访问策略** 区域修改，也可以使用 CLI：

```bash
chatcockpit access-policy status --json
chatcockpit access-policy set --console-path /my-console --json
chatcockpit access-policy set --lan-enabled true --lan-cidr <your-lan-cidr> --json
```

访问策略遵循以下边界：

- **新初始化默认生成随机安全入口**；`/ui` 只作为旧状态/内部构建回退。随机入口启用后，传统 `/ui` 返回普通 404，而且匿名管理员 status/login/Passkey 登录接口也要求携带当前入口知识，否则同样返回 404。这样隐藏的是实际登录面，而不只是 HTML 页面。
- 随机入口用于显著降低机会主义扫描与密码喷洒面，但仍是 defense-in-depth，**不能替代控制台管理员、Passkey、密码、登录限流、CSRF、HTTPS 等真实安全边界**。
- 匿名根状态不会投影随机控制台路径；App 可以直接从本机 canonical policy 读取真实入口，已登录管理员也可以通过受保护的 Integrations 状态看到有效 Local/Public Cockpit URL。
- 已登录的 Dashboard 与「公网接入」页面还会投影 **局域网控制台** readiness。只有 Trusted LAN 已启用、Runtime listener 确实监听对应地址族/地址，并且非 loopback 网卡地址命中可信 CIDR 时，Web 才会给出可点击的 LAN 控制台 URL；Web 不会为了生成入口而静默扩大 listener 或自动开启 Trusted LAN。
- Trusted LAN 默认关闭，必须显式提供 IPv4/IPv6 CIDR allowlist。未命中的直接非 loopback 请求在身份认证之前返回 404；命中的 LAN 客户端只是获得网络准入，访问受保护 API 仍必须完成管理员认证。
- 开启 LAN policy **不会自动修改 listener**。如果 `CHATCOCKPIT_HOST` 仍为 `127.0.0.1` / `::1`，其他设备仍无法连接；这是有意避免 App 静默扩大监听面。
- loopback reverse proxy 与直接 LAN peer 分开处理：只有明确受信任的本机反代链可以承载公网 HTTPS；非 loopback peer 不能通过伪造 `X-Forwarded-*` 绕过 LAN gate。
- 修改 policy 后，运行中的 Runtime 需要显式重启才能应用新的路由/准入规则；已停止 Runtime 保持停止。

## 暴露到 HTTPS

`CHATCOCKPIT_EXPOSED=true` 用于你控制的 HTTPS 入口。此模式下：

- 公网模式不再强制要求 `CHATCOCKPIT_API_TOKEN`；Web 控制台使用控制台管理员会话，ChatGPT Remote MCP 使用独立的 `chatcockpit:mcp` OAuth authority
- `CHATCOCKPIT_API_TOKEN` 仅在 CLI、自动化或 Custom GPT Actions 等兼容机器客户端需要 Bearer 访问时按需配置
- 控制台管理员会话、ChatGPT OAuth 与机器 token 三套 authority 相互独立，不互相继承
- `CHATCOCKPIT_PUBLIC_BASE_URL` 必须与远端客户端实际访问的公网地址一致

完整说明见：

- [`gpt-builder-setup.md`](./gpt-builder-setup.md)
- [`mcp-setup.md`](./mcp-setup.md)
- [`public-https-tunnel.md`](./public-https-tunnel.md)

## 状态检查

```bash
npm run mvp:status
npm run doctor:runtime
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/api/continuity/projects
curl http://127.0.0.1:4318/mcp
npm run mvp:status   # 使用 UI: 行中的随机安全入口检查 Web Cockpit
```

`doctor:runtime` 会检查：

- control plane host/port/public base URL
- Control Plane LaunchAgent 注册状态
- Runner LaunchAgent 注册状态
- Process Supervisor LaunchAgent 注册与 ready 状态
- `127.0.0.1:4318` 监听可达性；当本机没有 `lsof` 时，Doctor 会降级使用受限 TCP 探测，不再误报“没有 Listener”
- Runner heartbeat 和最近 job
- 本地 `/api/health`
- 本地当前安全入口（动态读取 `access-policy.json`）
- 最近 server log

`npm run mvp:status` 仍然提供简洁的生命周期摘要；`doctor:runtime` 现在也会统一输出 Process Supervisor 注册/ready 状态，并和 Control Plane、Runner、Listener、Health/UI probe、server log 一起作为实机诊断真源。

## 停止、重启、重置

```bash
npm run stop:local
npm run mvp:restart
npm run mvp:restart:wait   # 仅本机维护：同步等待重启终态
npm run reset:local
```

`mvp:restart` 是适合自举场景的安全路径：它把受限 Runtime restart operation 提交给独立、持久的 Process Supervisor，并在操作进入 scheduled 后立即返回，从而避免当前 Control Plane 在响应尚未送达时先把自己的 MCP/Host transport 杀掉。连接恢复后使用 `npm run mvp:status` 或 `npm run doctor:runtime` 验证新代际。只有在本机维护终端确实需要同步终态时才使用 `mvp:restart:wait`。

底层 `macos-manage-local-server.sh restart` 仍是由 Process Supervisor 执行的生命周期 executor；不要通过即将被它重启的 Control Plane 同步调用这个底层 action。

`reset:local` 会移除 LaunchAgent 和 pid/plist 运行文件，但保留源码和 `~/.chatcockpit/runtime/server.env`。

Packaged Mode 在 start / stop / restart / reset 前还会检查 LaunchAgent ownership。如果现有 service label 属于 Developer Mode 或另一份 Packaged Runtime，它会拒绝自动接管。Packaged stop 也不会终止不属于当前 Packaged State Root 的 foreign listener。

## 本地产物保留

Developer Mode 会把 ChatCockpit 的可写产品状态统一保存在 `~/.chatcockpit/`，与用户选择的项目 Workspace 分离；Packaged Mode 的等价可写 Runtime State 位于 `~/Library/Application Support/ChatCockpit/state/`。

Developer Mode 目录：

- `~/.chatcockpit/jobs/`：queued、running、completed、failed job records
- `~/.chatcockpit/bundles/`：pack prompts、summaries、manifests、bundle XML
- `~/.chatcockpit/runtime/repos/<repoId>/`：Codex prompts、stdout/stderr、diffs、reviews、summaries
- `~/.chatcockpit/manifests/`：task-pack markdown 和 JSON

Alpha 阶段默认保守，不主动删除 job records 或 Codex artifacts。需要清理 bundle XML 时，显式设置 `CHATCOCKPIT_BUNDLE_HISTORY_LIMIT` 或 `CHATCOCKPIT_REPOMIX_HISTORY_LIMIT`。
