# 本地运行与排障

本文说明如何在本机稳定运行 TokenPilot Control Plane、Continuity Store、Codex App Server Adapter、Runner 和本地操作员 Web UI。REST/MCP、Chat Direct、显式 Codex Session 与 Continuity 已实现；Custom GPT Actions、Remote MCP 和公网 HTTPS 仍属于实验性部署面。

## 构建与启动

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

macOS 上 `start:local` 会通过 LaunchAgent 同时管理：

- `com.wuaishare.tokenpilot.control-plane`
- `com.wuaishare.tokenpilot.runner`

异步 Job 需要 Runner 消费队列；Chat Direct 与 Codex Session 可以直接使用 Control Plane，不需要等待某个排队 Job 被 Runner 领取。

## 本地配置文件

推荐把运行配置放在：

```text
.tokenpilot/runtime/server.env
```

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
- LaunchAgent 注册状态
- runner LaunchAgent 注册状态
- `127.0.0.1:4318` 监听状态
- runner heartbeat 和最近 job
- 本地 `/api/health`
- 本地 `/ui`
- 最近 server log

## 停止、重启、重置

```bash
npm run stop:local
npm run mvp:restart
npm run reset:local
```

`reset:local` 会移除 LaunchAgent 和 pid/plist 运行文件，但保留源码和 `.tokenpilot/runtime/server.env`。

## 本地产物保留

TokenPilot 会把本地 job 和产物保存在 `.tokenpilot/`：

- `.tokenpilot/jobs/`：queued、running、completed、failed job records
- `.tokenpilot/bundles/`：pack prompts、summaries、manifests、bundle XML
- `.tokenpilot/runtime/repos/<repoId>/`：Codex prompts、stdout/stderr、diffs、reviews、summaries
- `.tokenpilot/manifests/`：task-pack markdown 和 JSON

Alpha 阶段默认保守，不主动删除 job records 或 Codex artifacts。需要清理 bundle XML 时，显式设置 `TOKENPILOT_BUNDLE_HISTORY_LIMIT` 或 `TOKENPILOT_REPOMIX_HISTORY_LIMIT`。
