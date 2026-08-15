# GPT Actions 与本地 Runner 闭环

本文说明 ChatCockpit 如何把 Custom GPT Actions 请求转成可追踪的本地执行。

## 目标链路

```text
Custom GPT Actions
  ↓ HTTPS + bearer auth
ChatCockpit control plane
  ↓
file-backed job queue
  ↓
local runner
  ↓
Codex CLI / local repo
  ↓
public-safe artifacts
  ↓
ChatGPT review
```

## 为什么需要 runner

GPT Actions 适合短请求。长耗时任务、复杂重构和大输出不应该同步卡在一次 HTTPS 调用里。

ChatCockpit 的做法是：

1. GPT Actions 创建 job。
2. Control plane 持久化 job。
3. Local runner 主动消费 job。
4. Runner 执行 Codex 或产物生成。
5. ChatGPT 查询 job 状态和 public-safe artifacts。

## GPT Actions 适合做什么

- `health`
- `listJobs`
- `getJob`
- 小范围 `readFiles`
- `searchCode`
- 小范围 `editFile`
- 短 `runShell`
- 创建 `createCodexRun`

## GPT Actions 不适合做什么

- 长时间同步等待复杂开发完成
- 直接暴露 raw shell
- 读取本地私有路径
- 输出 token、env、日志和机器路径

## HTTPS 边界

Custom GPT Actions 必须访问公网 HTTPS。对于本地电脑，通常需要反向代理或内网穿透把 HTTPS 转发到 `127.0.0.1:4318`。

详见：

- [公网 HTTPS / 内网穿透](../deployment/public-https-tunnel.md)
- [GPT Builder 配置指南](../deployment/gpt-builder-setup.md)

## 验证顺序

1. 本地 `/api/health` 正常。
2. 公网 `/api/health` 正常。
3. 公网 `/openapi.yaml` 正常。
4. GPT Builder 成功导入 schema。
5. Custom GPT 成功调用 `health`。
6. Custom GPT 能创建 job。
7. Runner 能把 job 推进到 completed 或 failed。
8. ChatGPT 能读取 public-safe artifacts。
