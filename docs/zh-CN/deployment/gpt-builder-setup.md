# GPT Builder 配置指南

本指南说明如何把 ChatCockpit 接入一个 Custom GPT，让 ChatGPT 通过 GPT Actions 调用你的本地控制面。GPT Actions 是建立在已实现 REST/OpenAPI 服务之上的实验性部署面；GPT Builder 缓存、代理、HTTPS 入口和客户端兼容性仍取决于实际环境。

## 前提

先完成：

- [`beginner-quickstart.md`](./beginner-quickstart.md)
- 本地控制面已启动
- 本地 runner 已启动
- 已准备一个公网 HTTPS 地址，能转发到 `http://127.0.0.1:4318`
- 已准备一个强随机 `CHATCOCKPIT_API_TOKEN`

## 1. 配置运行环境

编辑 `~/.chatcockpit/runtime/server.env`：

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-token
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

然后重启：

```bash
npm run mvp:restart
npm run doctor:runtime
```

确认本地控制面健康：

```bash
curl http://127.0.0.1:4318/api/health
```

确认公网 HTTPS 地址可访问：

```text
https://chatcockpit.example.com/api/health
https://chatcockpit.example.com/openapi.yaml
```

这里的域名是占位示例。实际配置时使用你自己的 HTTPS 地址。

## 2. 打开 GPT Helper

访问：

```text
http://127.0.0.1:4318/ui/gpt-helper
```

在页面中确认：

- 产品版本
- 指令与 Schema 修订
- API 基址
- OpenAPI 地址
- Schema 导入 URL
- GPT Instructions

如果你改了域名、token、产品版本或 OpenAPI schema，重新打开 GPT Helper，并重新复制说明。

## 3. 创建 Custom GPT

在 ChatGPT 中进入 GPT Builder：

1. 创建一个新的 GPT，或打开已有 GPT。
2. 在 Instructions 中粘贴 GPT Helper 生成的说明。
3. 保存描述、能力开关和可见性设置。

建议能力：

- 打开 Actions。
- 文件上传、联网、画图等能力按你的实际需要选择。
- 不要在说明里写入真实 token。

## 4. 导入 Actions schema

在 GPT Builder 的 Actions 区域：

1. 新建 Action。
2. 导入 GPT Helper 给出的 Schema 导入 URL，通常是：

```text
https://chatcockpit.example.com/openapi.yaml
```

3. 确认 OpenAPI server URL 指向你的 HTTPS 地址。
4. 保存 Action。

如果导入失败，优先检查：

- 该 URL 是否是公网 HTTPS。
- 浏览器能否直接访问 `/openapi.yaml`。
- OpenAPI description 是否超过 GPT Builder 限制。
- 是否仍在使用旧域名或旧缓存。

ChatCockpit 的本地 E2E 已检查 OpenAPI description 长度，避免超过常见导入限制。

## 5. 配置 Authentication

ChatCockpit exposed mode 使用 bearer auth。GPT Builder 的 Authentication 应配置为 API Key / Bearer 类型，并使用与 `~/.chatcockpit/runtime/server.env` 中相同的 `CHATCOCKPIT_API_TOKEN`。

不要把 token 写进 README、OpenAPI 文件、GPT Instructions 或 Git 提交。

## 6. 验证 Actions

在 GPT 预览里先执行只读测试：

```text
请调用 ChatCockpit health，确认控制面可达。不要写文件。
```

再测试 jobs：

```text
请列出当前 jobs，只返回状态摘要。不要修改仓库。
```

最后测试一个安全读取任务：

```text
请读取 README.md 的前 2KB，并总结项目定位。不要写文件。
```

这些测试通过后，明确选择运行模式：

- Chat Direct：ChatGPT 保持模型循环，调用文件、搜索、受控命令与 Git；
- Codex Session：先 Bind/Resume/Fork Thread，再显式启动 Codex Turn 并处理 Approval；
- Async Agent Job：通过 `createCodexRun` 进入本地 Runner。

`thread/resume` 和 `thread/fork` 只恢复或创建 Runtime Binding，不会启动模型循环。

## 7. 更新时机

以下变化后应重新导入 schema，并更新 GPT Instructions：

- OpenAPI schema 变化
- GPT instructions / schema 修订号变化
- `CHATCOCKPIT_PUBLIC_BASE_URL` 变化
- 域名、路径、HTTPS 入口变化
- 产品版本变化
- 新增或删除 Actions

## 8. 安全边界

- GPT Actions 只能访问你配置的 HTTPS 地址。
- Exposed Mode 必须通过 Bearer Auth，受保护的 REST、MCP、Continuity、Runtime、Job、File、Shell 与 Git 数据不会匿名返回。
- Chat Direct Standalone 只有在本机 Probe 验证具体 App Server 方法后才会启用。
- `runShell` 是高信任本地命令 API，不是公网 Raw Shell；命令白名单、Workspace Allowlist、超时、输出上限和 Exposed Mode 开关仍然生效。
- Codex Turn 需要 Runtime Binding、Writer Lease、Pre-run Handoff、Evidence、Revision 与固定 User Approval Policy。
- Git、Handoff、Evidence、Approval、Event 与 Artifact 输出使用 Public-safe Projection。
- 真实域名、Token、Tunnel Token、机器路径、原始 Approval Request Body 和本地运行态都不进入 Git。

## 9. 能力状态

| 接入面 | 状态 |
|---|---|
| 本地 REST/OpenAPI 服务 | 已实现 |
| Bearer Auth、结构化错误和幂等 | 已实现 |
| Continuity / Runtime 操作 | 已实现 |
| 通过自有 HTTPS 连接 Custom GPT Actions | 实验性 |
| 不同 GPT Builder 版本、代理和网络的长期兼容 | 验证中 |
| ChatCockpit 公共托管服务 | 未实现 |

MCP 客户端请使用 [`mcp-setup.md`](./mcp-setup.md)，不要导入 OpenAPI Schema。
