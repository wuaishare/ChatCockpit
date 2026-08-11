# 本地运行与排障

本文说明如何在本机稳定运行 TokenPilot Control Plane、Continuity Store、Codex App Server Adapter、Runner、Durable Process Supervisor sidecar 和本地操作员 Web UI。REST/MCP、Chat Direct、显式 Codex Session 与 Continuity 已实现；Custom GPT Actions、Remote MCP 和公网 HTTPS 仍属于实验性部署面。

## 构建与启动

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

如果希望使用原生 macOS 菜单栏操作壳和本地 unsigned App，请参阅 [`macos-desktop.md`](./macos-desktop.md)。

除非特别说明，本文命令描述的是 **Developer / Source Mode**。Phase 2 的 macOS Packaged Mode 继续复用同一套 Node/TypeScript Runtime 实现，但使用内置 Node `24.18.1`，把 Runtime / State / Config 部署到 Application Support，并让用户单独选择真实项目 Workspace。Packaged Mode 运行时不要求系统 Node/npm，也不要求 TokenPilot checkout。

macOS 上 `start:local` 会把三项 LaunchAgent 作为一个本地运行栈统一管理：

- `com.wuaishare.tokenpilot.control-plane`
- `com.wuaishare.tokenpilot.runner`
- `com.wuaishare.tokenpilot.process-supervisor`

异步 Job 需要 Runner 消费队列；Chat Direct 与 Codex Session 可以直接使用 Control Plane，不需要等待某个排队 Job 被 Runner 领取。Process Supervisor 独立持有 Durable Managed Process runtime；普通 `restart` 会重启 Control Plane / Runner，但会保留当前 Process Supervisor generation，而不是静默替换它。

## 本地配置文件

Developer Mode 推荐把运行配置放在：

```text
.tokenpilot/runtime/server.env
```

Packaged Mode 的等价私有配置位于 TokenPilot Application Support State Root，不会写进所选项目 Workspace。不要为了迁移旧环境而手工复制 Source Mode secret；Desktop 的 Existing Setup Import 明确不会迁移 bearer/OAuth/provider 等凭据。

本地模式示例：

```bash
TOKENPILOT_EXPOSED=false
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
```

GPT Actions 模式示例：

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-token
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

占位域名只用于文档。真实域名、token、tunnel token 和机器路径不要提交到 Git。

## Web UI

启动后访问：

```text
http://127.0.0.1:4318/ui
```

常用页面：

- `/ui`：Dashboard / Setup Wizard
- `/ui/continuity/projects`：Project、Workspace、Writer Lease 与 Git
- `/ui/continuity/tasks`：真实 Task 状态
- `/ui/continuity/sessions`：Chat Direct、Codex Session、Async Agent Session
- `/ui/continuity/handoffs`：Prepare、Accept、Fork、Cancel
- `/ui/continuity/evidence`：Evidence Checklist 与保守验证状态
- `/ui/continuity/approvals`：待处理 Runtime Approval
- `/ui/gpt-helper`：GPT Instructions、OpenAPI URL、Schema 导入 URL
- `/ui/jobs`：Jobs、Artifacts、进程控制

在需要鉴权的模式下，浏览器会话提供 bearer token 前不会展示受保护数据。

## 暴露到 HTTPS

`TOKENPILOT_EXPOSED=true` 用于你控制的 HTTPS 入口。此模式下：

- 必须设置 `TOKENPILOT_API_TOKEN`
- GPT Builder Authentication 必须使用同一个 token
- `TOKENPILOT_PUBLIC_BASE_URL` 必须与 GPT Builder 导入的 OpenAPI server URL 一致

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
curl http://127.0.0.1:4318/ui
```

`doctor:runtime` 会检查：

- control plane host/port/public base URL
- Control Plane LaunchAgent 注册状态
- Runner LaunchAgent 注册状态
- `127.0.0.1:4318` 监听状态
- Runner heartbeat 和最近 job
- 本地 `/api/health`
- 本地 `/ui`
- 最近 server log

Process Supervisor 的注册/ready 真源当前由 `npm run mvp:status` 直接报告；`doctor:runtime` 尚未把 Supervisor 诊断纳入统一输出。后者属于后续产品化加固任务，不在本文中提前宣称已经实现。

## 停止、重启、重置

```bash
npm run stop:local
npm run mvp:restart
npm run reset:local
```

`reset:local` 会移除 LaunchAgent 和 pid/plist 运行文件，但保留源码和 `.tokenpilot/runtime/server.env`。

Packaged Mode 在 start / stop / restart / reset 前还会检查 LaunchAgent ownership。如果现有 service label 属于 Developer Mode 或另一份 Packaged Runtime，它会拒绝自动接管。Packaged stop 也不会终止不属于当前 Packaged State Root 的 foreign listener。

## 本地产物保留

Developer Mode 会把本地 job 和产物保存在 `.tokenpilot/`；Packaged Mode 的等价可写 Runtime State 位于 `~/Library/Application Support/TokenPilot/state/`，与用户选择的项目 Workspace 分离。

Developer Mode 目录：

- `.tokenpilot/jobs/`：queued、running、completed、failed job records
- `.tokenpilot/bundles/`：pack prompts、summaries、manifests、bundle XML
- `.tokenpilot/runtime/repos/<repoId>/`：Codex prompts、stdout/stderr、diffs、reviews、summaries
- `.tokenpilot/manifests/`：task-pack markdown 和 JSON

Alpha 阶段默认保守，不主动删除 job records 或 Codex artifacts。需要清理 bundle XML 时，显式设置 `TOKENPILOT_BUNDLE_HISTORY_LIMIT` 或 `TOKENPILOT_REPOMIX_HISTORY_LIMIT`。
