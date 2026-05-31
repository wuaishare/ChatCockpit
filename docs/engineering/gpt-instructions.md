# GPT Instructions

## Status

This document is a transitional helper for manually configuring Custom GPT / GPT Actions during the local-first alpha stage.

The Web UI now provides a built-in GPT configuration panel, including:

- configuration version
- updatedAt
- OpenAPI URL
- schema import URL
- current recommended instructions

This document and the related generation script remain as a CLI-compatible companion, but the Web UI should now be treated as the primary operator-facing source of GPT configuration truth.

如果你要给 TokenPilot 配置一个 Custom GPT，建议同时准备两样东西：

- 一份适合粘贴进 GPT 编辑页主说明框的指令
- 一份与你当前部署域名、动作主机和本机时区相匹配的版本

## 推荐做法

默认直接运行：

```bash
npm run gpt:instructions
```

它会输出一份可直接复制的 GPT 指令草稿，并自动带上：

- 当前机器的 IANA 时区
- 当前 `TOKENPILOT_PUBLIC_BASE_URL`
- 由该基址解析出的动作主机

如果你没有设置 `TOKENPILOT_PUBLIC_BASE_URL`，脚本会回退到占位值 `https://tokenpilot.example.com`。

## 为什么需要自动生成

GPT 指令里有几类信息最好和用户当前环境保持一致：

- 时间展示规则
- 当前动作主机
- 当前公开基址

这些内容如果写死，容易导致：

- 错把 UTC 展示成别的时区
- 域名切换后仍引用旧部署
- GPT 在调试时把测试环境和正式环境混在一起

## 手动修改也可以

脚本输出的是草稿，不是强制配置。

你可以在 GPT 编辑页中继续手动调整，例如：

- 用更符合自己表达习惯的中文措辞
- 缩短或扩展状态获取规则
- 针对自己的 runner / artifact 消费习惯增加约束

建议保留这些核心规则：

- `health` 只用于可达性、mode 和 auth，不是完整状态接口
- `queued/running` 只能当作中间态，不能直接判异常
- 不输出本地绝对路径
- 对外统一使用 `repoId`
- 对审查、规划、开发、验证等非读取类任务，优先使用 `createCodexRun`
- 较大开发任务建议 `worktreePolicy=always`，极小任务可建议 `worktreePolicy=never`，最终由用户决定
- 默认 `commitPolicy=propose`；只有用户明确要求自动提交时才使用 `commitPolicy=commit`
- 不夸大当前阶段完成度

## 当前阶段推荐边界表述

建议使用中文来描述状态边界，不要把状态结果写死成固定模板。

更好的做法是：

- 先根据当前接口返回得出结论
- 再按下面这组边界来组织回答

推荐边界术语：

- local-first 自动化骨架
- Phase 2 安全基础
- 本地 E2E 验证
- 完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中

避免直接写成：

- “安全自动化闭环已完成”
- “完整 HTTPS / Custom GPT Actions / artifact consumption 生产闭环已完成”

## ChatGPT 直驱开发模式（Phase 2）

自 Phase 2 起，TokenPilot 已补齐写侧 API，ChatGPT 可以在不经过 Codex CLI 的情况下直接完成本地开发任务。

### 新增能力

- `writeFile` — 创建或覆盖文本文件（最大 512 KB）
- `editFile` — Search/replace 精准编辑（要求 search 文本在文件中唯一）
- `listDirectory` — 列出目录内容
- `searchCode` — 代码搜索（ripgrep，最多 40 条结果，可选上下文行）
- `runShell` — 运行白名单命令（npm, npx, node, python, tsc, eslint, vitest, git, cargo, go, make 等），输出截断 64 KB，执行上限 25s
- `getGitDiff` — 查看未提交变更
- `getGitStatus` — 查看 git 状态和分支
- `gitCommit` — 仅暂存 public-safe 路径并提交

### 推荐工作流

1. **了解项目**：`listDirectory` 看结构，`readFiles` 看关键文件，`searchCode` 定位代码
2. **编辑代码**：优先用 `editFile`（search/replace），创建新文件才用 `writeFile`
3. **验证**：`runShell` 运行 `npm run build` / `npm test` / `tsc --noEmit`
4. **提交**：`getGitDiff` 检查变更 → `gitCommit` 提交

### 与 createCodexRun 的互补关系

- **微小编辑**（改一行文案、修一个 typo）→ 用 ChatGPT 直驱
- **复杂开发**（跨文件重构、多步骤任务）→ 仍推荐 `createCodexRun`，让 Codex 执行完整循环
- **两者不互斥**：ChatGPT 可以先 `searchCode` 定位问题，再决定是自己改还是交给 Codex

### 安全边界

- 所有写操作复用现有 allowlist + repo mapping + 路径校验
- `runShell` 为命令白名单模式，不是 raw shell；但它仍是高信任本地命令执行 API，只应在私有、受鉴权的 operator 环境中使用
- `getGitDiff`、`gitCommit` 和 Codex diff artifacts 只处理 public-safe 路径；`.env`、`.tokenpilot`、日志等本地私有路径不会进入公开 diff / commit 输出
- 默认需要 bearer auth（`TOKENPILOT_EXPOSED=1` + `TOKENPILOT_API_TOKEN`）

### GPT 指令更新建议

在 Custom GPT 的 Instructions 中增加：

```
你现在可以：

- 使用 writeFile 创建或覆盖文本文件
- 使用 editFile 对文件中唯一的一段文字进行精确搜索替换（search 必须在文件中只出现一次）
- 使用 listDirectory 列出目录内容
- 使用 searchCode 进行代码搜索
- 使用 runShell 运行白名单命令来验证构建、测试或检查代码
- 使用 getGitDiff 和 getGitStatus 查看仓库变更
- 使用 gitCommit 提交变更

文件操作规则：
- 小改动优先用 editFile，新建文件才用 writeFile
- 写入前先用 readFiles 确认当前内容
- searchCode 先定位再精读，不必整文件读取
- runShell 只用于白名单内的短耗时验证命令；不要用它执行长任务或高风险变更
- Git diff / commit 输出可能跳过 public-unsafe 路径；看到 blocked 或缺失时应提示用户本地检查，而不是复述私有路径内容

你仍然可以使用 createCodexRun 来委托复杂开发任务给本地 Codex CLI 执行和审查。
```
