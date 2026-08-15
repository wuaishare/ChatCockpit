# 为本地控制面绑定公网 HTTPS 地址

Custom GPT Actions 不能访问你电脑上的 `127.0.0.1`。如果要让 ChatGPT 调用本地 ChatCockpit，需要一个你控制的公网 HTTPS 地址，并把请求转发到本机控制面。

## 目标链路

```text
ChatGPT / Custom GPT Actions
  ↓ HTTPS
你的公网域名或 tunnel URL
  ↓
本机 127.0.0.1:4318
  ↓
ChatCockpit control plane
  ↓
local runner / Codex CLI
```

## 必要条件

- HTTPS URL 可从公网访问。
- HTTPS 入口转发到 `http://127.0.0.1:4318`。
- ChatCockpit 使用 `CHATCOCKPIT_EXPOSED=true`。
- `CHATCOCKPIT_API_TOKEN` 已设置，并与 GPT Builder Authentication 一致。
- `CHATCOCKPIT_PUBLIC_BASE_URL` 与 GPT Builder 导入的 OpenAPI server URL 一致。

## 推荐配置

`~/.chatcockpit/runtime/server.env`：

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-token
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

重启并检查：

```bash
npm run mvp:restart
npm run doctor:runtime
```

## 选择公网入口

ChatCockpit 不要求固定方案。常见选择：

| 方案 | 适合场景 | 注意点 |
| --- | --- | --- |
| 自有反向代理 | 已有服务器和域名 | 需要自己维护 TLS、转发规则和访问控制 |
| Cloudflare Tunnel | 想把本机服务映射到域名 | 注意 tunnel token 不要进入 Git |
| ngrok | 临时测试和快速验证 | 免费域名可能变化，GPT Builder 里要同步更新 |
| Tailscale Funnel | 已使用 Tailscale | 注意访问策略和公网暴露范围 |

无论用哪种方式，公开仓库都只保留 `https://chatcockpit.example.com` 这类占位示例。

## GPT Builder 使用的 URL

配置完成后，GPT Builder 中应使用：

```text
https://chatcockpit.example.com/openapi.yaml
```

并确保 OpenAPI server URL 也是同一个 HTTPS 基址。

## 验证顺序

1. 本机检查：

```bash
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/openapi.yaml
```

2. 公网 HTTPS 检查：

```text
https://chatcockpit.example.com/api/health
https://chatcockpit.example.com/openapi.yaml
```

3. GPT Builder 导入 schema。
4. 在 Custom GPT 里调用 `health`。
5. 再测试只读文件读取或 jobs 查询。

## 常见问题

| 现象 | 常见原因 | 处理方式 |
| --- | --- | --- |
| 502 | HTTPS 入口可用，但本机 control plane 未启动 | `npm run mvp:status`，再 `npm run mvp:restart` |
| 401 | token 不匹配 | 检查 GPT Builder Authentication 和 `CHATCOCKPIT_API_TOKEN` |
| schema 导入失败 | `/openapi.yaml` 不可达或不是 HTTPS | 先用浏览器打开 schema URL |
| Actions 调用超时 | GPT Actions 有短超时窗口 | 长任务使用 `createCodexRun`，不要同步等待完成 |
| Codex job queued | runner 未消费队列 | `npm run doctor:runtime` 查看 runner 状态 |

## 安全边界

- 不要把 ChatCockpit 暴露成无鉴权公网服务。
- 不要把 bearer token 写入 README、OpenAPI、GPT Instructions 或 issue。
- 不要把 tunnel token、反向代理私有配置、机器路径提交到 Git。
- `runShell` 是高信任能力；exposed mode 下默认限制高信任命令。
- GPT Actions 适合发起任务、查询状态和读取 public-safe 结果；复杂执行交给本地 runner。
