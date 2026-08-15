# ChatCockpit 新手快速开始

这是一条从源码到本地控制台的最短路径。ChatCockpit 是本地优先的 AI 开发连续性与 Agent 能力路由平台；先跑通本地 Control Plane、Continuity Workbench 与运行模式，再配置 Custom GPT Actions 或 MCP。

## 1. 准备环境

需要：

- macOS（当前一键启动脚本使用 LaunchAgent）
- Node.js 22+
- npm
- Git
- 可用的 Codex Binary（使用 Codex Session 或 Codex 异步 Job 时需要）
- ChatGPT 账号（只在配置 Custom GPT Actions 时需要）

## 2. 安装、初始化、启动

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

打开本地控制台：

```text
http://127.0.0.1:4318/ui
```

成功状态：

- `/ui` 可以打开，并显示 Setup Wizard 或 Dashboard。
- `/ui/continuity/projects` 可以打开 Continuity Workbench。
- `npm run doctor:runtime` 能访问本地 Health。
- GPT Helper 能显示 GPT 指令、OpenAPI URL、Schema 导入 URL。
- Chat Direct 可以完成一次不启动 Codex Turn 的安全只读操作。
- Codex Session 可以先 Bind/Resume/Fork Thread，再通过独立操作显式启动 Turn。
- Jobs 页面可以查看异步任务状态。

## 3. 本地模式与 GPT Actions 模式

本地模式是默认新手路径：

```bash
CHATCOCKPIT_EXPOSED=false
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
```

Custom GPT Actions 需要 ChatGPT 访问一个 HTTPS 地址。你的电脑在家用网络或公司网络里时，通常需要一层公网入口把 HTTPS 请求转发到本机 `127.0.0.1:4318`，例如：

- 自己已有的反向代理
- Cloudflare Tunnel
- ngrok
- Tailscale Funnel
- 其他你信任的内网穿透服务

ChatCockpit 不绑定某个穿透供应商。你只需要保证最终有一个你控制的 HTTPS URL 指向本机控制面。

暴露给 GPT Actions 时必须启用 token：

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-token
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

`https://chatcockpit.example.com` 是占位示例。实际使用时换成你的 HTTPS 地址，不要把真实域名、Bearer token、tunnel token 或机器路径提交到 Git。

## 4. 创建并配置 Custom GPT

Custom GPT Actions 完整步骤见 [`gpt-builder-setup.md`](./gpt-builder-setup.md)；MCP 客户端接入见 [`mcp-setup.md`](./mcp-setup.md)。

最短流程：

1. 启动 ChatCockpit 本地控制面和 runner。
2. 配置你的 HTTPS 入口，让它转发到 `http://127.0.0.1:4318`。
3. 设置 `~/.chatcockpit/runtime/server.env` 里的 `CHATCOCKPIT_PUBLIC_BASE_URL` 和 `CHATCOCKPIT_API_TOKEN`。
4. 打开 `http://127.0.0.1:4318/ui/gpt-helper`。
5. 复制 GPT Instructions。
6. 在 GPT Builder 里创建或编辑 GPT，把说明粘贴到 Instructions。
7. 在 Actions 里导入 OpenAPI schema。
8. 配置 Authentication，使用 Bearer token。
9. 保存 GPT，用 `health` 或短只读任务测试。

## 5. 第一个安全测试

先测试只读能力：

```text
请调用 ChatCockpit health，然后列出当前可见 jobs。不要修改文件。
```

再测试一个小的 Chat Direct 任务：

```text
请读取 README.md 的开头，并总结当前项目定位。不要写文件。
```

确认读写链路后，再明确选择：Chat Direct 文件/搜索/命令/Git、Codex Session Thread/Turn/Approval，或 `createCodexRun` 异步 Job。

## 6. 常见问题

| 现象 | 常见原因 | 处理方式 |
| --- | --- | --- |
| UI 能打开，但 GPT Actions 访问失败 | GPT 不能访问 `127.0.0.1` | 配置 HTTPS 入口或内网穿透 |
| GPT Builder 导入 schema 失败 | URL 不是公网 HTTPS，或 `/openapi.yaml` 不可达 | 先在浏览器访问 `https://你的域名/openapi.yaml` |
| 调用 Actions 返回 401 | Bearer token 不一致 | 检查 GPT Builder Authentication 和 `CHATCOCKPIT_API_TOKEN` |
| Codex job 一直 queued | Runner 未运行 | 执行 `npm run start:local` 和 `npm run doctor:runtime` |
| Continuity 页面没有项目 | 尚未配置有效 Repo Mapping | 重新运行 Setup/Init，并检查本地 ChatCockpit 配置 |
| Workspace 显示只读 | 另一个 Session 持有 Writer Lease | 查看 Writer Banner，通过 Handoff 接力，不要强行并发写入 |
| Handoff 没有显示已验证 | 必需 Evidence 缺失、不完整、跳过或失败 | 记录并完成必需验证项 |
| `runShell` 被拒绝 | exposed mode 阻止高信任命令 | 使用本地模式，或确认风险后设置 `CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true` |
