# 本地优先控制面架构

TokenPilot 的控制面默认运行在本机。ChatGPT 负责规划与指挥，TokenPilot 负责把对话意图转成受控的本地 API、job、artifacts 和审查材料。

## 核心角色

```text
ChatGPT
  ↓
TokenPilot control plane
  ↓
file-backed job queue
  ↓
local runner
  ↓
Codex CLI / local repo
```

- ChatGPT：上下文管理、任务规划、结果审查。
- Control plane：提供 OpenAPI、文件操作、搜索、shell、Git、job API。
- File-backed queue：持久化 jobs。
- Runner：消费 jobs，调用 Codex CLI 或生成 artifacts。
- Public-safe artifacts：过滤私有路径、token、日志和本地运行态。

## 双模式

### GPT 直驱

适合：

- 小文案修改
- 单文件编辑
- 搜索定位
- 短验证命令
- Git diff/status/commit

常用 Actions：

- `readFiles`
- `writeFile`
- `editFile`
- `searchCode`
- `runShell`
- `getGitDiff`
- `getGitStatus`
- `gitCommit`

### Codex 异步

适合：

- 多文件重构
- 复杂功能开发
- 需要 worktree 的任务
- 需要 diff/review/summary artifacts 的任务

常用 Action：

- `createCodexRun`

## 安全边界

- 本地模式默认绑定 `127.0.0.1`。
- 暴露到 HTTPS 时必须启用 bearer auth。
- `runShell` 是高信任本地命令 API，不是公网 raw shell。
- Git diff、commit、Codex artifacts 只输出 public-safe 内容。
- 真实域名、token、tunnel token 和本地路径不要进入 Git。

## 相关文档

- [新手快速开始](../deployment/beginner-quickstart.md)
- [GPT Builder 配置指南](../deployment/gpt-builder-setup.md)
- [公网 HTTPS / 内网穿透](../deployment/public-https-tunnel.md)
