# GPT Actions 边界探测指南

探测 ChatGPT (Custom GPT + GPT Actions) 调用 TokenPilot API 时的四维边界：超时、速率、上下文窗口、响应体积。

---

## 0. 前置条件

- TokenPilot 已通过 HTTPS 暴露（`TOKENPILOT_EXPOSED=1`，`TOKENPILOT_API_TOKEN` 已设置）
- Custom GPT 已配置 TokenPilot 的 OpenAPI schema（从 `/api/gpt/config` 获取最新 `schemaImportUrl`）
- 建议先跑一轮 `health` 确认连通性

---

## 1. 超时边界

**问题**：GPT Action 的 HTTP 调用最长能等多久？TokenPilot 的 `runShell` 默认 30s 上限，ChatGPT 端的超时是多少？

### 探测方法

在 TokenPilot 服务端临时增加一个延迟端点（测试后删除）：

```bash
# 在 src/server/app.ts 中临时添加：
app.get("/api/test/timeout/:ms", async (request) => {
  const ms = Math.min(parseInt((request as any).params.ms) || 1000, 120_000);
  await new Promise(r => setTimeout(r, ms));
  return { ok: true, waited: ms };
});
```

### 探测步骤

在 ChatGPT 中依次请求：

| 请求 | 预期 |
|---|---|
| "测试 5 秒延迟" → `GET /api/test/timeout/5000` | ✅ 返回 |
| "测试 15 秒延迟" → `GET /api/test/timeout/15000` | ✅ 返回 |
| "测试 30 秒延迟" → `GET /api/test/timeout/30000` | ⚠️ 边界 |
| "测试 45 秒延迟" → `GET /api/test/timeout/45000` | ❌ 可能超时 |
| "测试 60 秒延迟" → `GET /api/test/timeout/60000` | ❌ 很可能超时 |

### 预期结果

- GPT Actions 的 HTTP 超时大约在 **30-45 秒**之间
- 超过此时间的 API 必须设计为**异步模式**（提交 job → 轮询状态）
- TokenPilot 的 `runShell` 30s 上限应在此范围内

### 代码适配建议

- 如果超时边界 < 30s：`runShell` 需要改为异步 job 模式
- 如果超时边界 ≥ 30s：当前设计 OK，但 `npm install` 等长操作仍需走 `createCodexRun` 异步模式

---

## 2. 速率限制

**问题**：ChatGPT 多快能发一次 API 调用？连续调用间有无强制间隔？

### 探测方法

使用 TokenPilot 的 `health` 端点（无副作用，响应小）：

在 ChatGPT 中说：

> "连续调用 health 接口 10 次，每次收到结果后立刻发下一次，记录每次的响应时间"

观察：
- 10 次调用是否全部成功？
- 有没有被限速（429 或 ChatGPT 拒绝发起调用）？
- 平均间隔是多少？

### 探测变体

> "现在同时（parallel）调用 health、getGitStatus、listJobs — 三个调用一起发"

观察 ChatGPT 是否支持并行 Action 调用，以及是否有并发数上限。

### 预期结果

- 串行调用通常不限速（但 ChatGPT 会自然间隔 1-3 秒用于处理和展示）
- 并行调用可能有 2-3 个上限
- OpenAI 的 API 层面通常没有 GPT Actions 专用速率限制，但 ChatGPT 前端可能限制并发

### 代码适配建议

- 如果串行间隔 ≥ 2s：复杂的多步操作（读文件→改→验证）总延迟可能被感知
- 建议 ChatGPT 在 GPT 指令中被告知："连续操作时合并可并行的 API 调用"
- TokenPilot 服务端本身不需要做 rate limit（ChatGPT 侧已有限制）

---

## 3. 上下文窗口

**问题**：ChatGPT 的上下文窗口能放多少文件内容？读取大文件会不会压爆窗口？

### 探测方法

**方法 A：梯度文件大小**

1. 在测试仓库准备多个不同大小的 markdown 文件：1KB, 5KB, 20KB, 50KB, 100KB, 200KB
2. 让 ChatGPT 逐个读取并总结：

> "读取 repoId=tokenpilot 的文件 test/size-1kb.md，总结内容。然后读 test/size-5kb.md，总结内容。..."

3. 观察在哪一步开始出现：
   - 总结质量下降（"这个文件包含..." 而不是具体内容）
   - 明确拒绝读取（"文件太大"）
   - 忘记之前读过的内容

**方法 B：累积读取**

> "读取并记住以下文件：src/types.ts, src/server/app.ts, src/core/config.ts。读完后，告诉我这三个文件的共同点。"

观察 ChatGPT 是否能准确回忆所有三个文件的内容。

### 预期结果

- ChatGPT 的实际可用上下文窗口通常 **远小于** 模型标称值（GPT-4 标称 128K 但可用 ~64K-96K）
- GPT 指令本身占用一部分，对话历史占用一部分
- 单次读取 > 50KB 的文件可能就开始出现截断/降质
- 累计读取 3-5 个大文件后，旧的上下文可能被压缩（compaction）

### 代码适配建议

- TokenPilot 的 `readFile` 已有 64KB 分页上限 — 对大文件 ChatGPT 需要分段读取
- GPT 指令中应加入："读取大文件时使用 offset/limit 分页，一次性不超过 20KB"
- `searchCode` 先定位再精读的策略应该被 GPT 指令强调
- 如果 ChatGPT 频繁出现"忘记上下文"，考虑在 TokenPilot 新增 `/api/summary/save` 端点来持久化中间状态

---

## 4. 响应体积上限

**问题**：TokenPilot API 返回的 JSON 能多大？GPT Action 能否消费大响应？

### 探测方法

**方法 A：大 diff**

1. 修改一个文件，插入大量内容（如：50KB 的注释）
2. 让 ChatGPT 调用 `getGitDiff`
3. 观察 ChatGPT 是否能完整展示 diff，还是会截断

**方法 B：搜索结果**

> "在 repo 中搜索 pattern='.' （匹配所有行），记录返回了多少结果"

观察 `truncated` 是否为 `true`，以及 ChatGPT 如何处理截断信号。

**方法 C：大目录**

> "列出 node_modules 目录（如果存在），看看能返回多少条目"

注意：`listDirectory` 会跳过 `node_modules` 等 blocked 路径，所以实际测试应针对大源码目录。

### 预期结果

- GPT Action 响应体积通常无硬限制（由 HTTP 协议决定）
- 但 ChatGPT 对超大响应的展示可能截断（~8K-16K token 的可视区域）
- 即使响应完整到达，ChatGPT 也可能只"看到"前 N 个 token

### 代码适配建议

- TokenPilot 的 `getGitDiff` 已有 256KB 截断 — 够用
- `searchCode` 最多 40 条结果 — 安全
- 如果 ChatGPT 反馈"看不到完整结果"：告知 ChatGPT 需要指定更精确的搜索条件
- 考虑在响应中加入 `"tip"` 字段："结果已截断，建议用更精确的 pattern 或指定 path 缩小范围"

---

## 5. 综合压力探测

**场景**：模拟真实开发任务

### 探测流程

> "请完成以下任务：
> 1. 用 listDirectory 看 src/ 下有哪些文件
> 2. 用 searchCode 搜索 'TODO' 在所有 .ts 文件中
> 3. 用 readFiles 读取找到的第一个文件
> 4. 用 editFile 把 'TODO' 改成 'FIXME'
> 5. 用 runShell 运行 'tsc --noEmit'
> 6. 用 getGitDiff 查看变更
> 7. 如果一切正常，用 gitCommit 提交，message='chore: TODO → FIXME'
>
> 每步完成后报告状态，不要跳过。"

### 需要观察

| 指标 | 观察方法 |
|---|---|
| 总耗时 | 记录开始和结束时间 |
| 是否遗漏步骤 | 检查 ChatGPT 是否跳过了某步 |
| 是否编造结果 | 对比实际 API 返回 vs ChatGPT 的表述 |
| 错误恢复 | 如果某步失败，ChatGPT 如何处理 |
| 提交是否真的发生了 | 在终端 `git log -1` 验证 |

---

## 6. 结果记录模板

探测完成后，在 `docs/proof/gpt-actions-limits-report.md` 中记录：

```markdown
# GPT Actions 边界探测报告

探测日期：YYYY-MM-DD
ChatGPT 模型：GPT-4 / GPT-4o / ...
TokenPilot 版本：从 /api/health 获取

## 超时

| 延迟 | 结果 | 备注 |
|---|---|---|
| 5s | ✅ | ... |
| 15s | ✅ | ... |
| 30s | ✅/❌ | ... |
| 45s | ❌ | 超时错误信息: ... |
| 60s | ❌ | ... |

结论：GPT Action 超时边界 ≈ XX 秒

## 速率

| 测试 | 调用次数 | 总耗时 | 是否全部成功 |
|---|---|---|---|
| 串行 health x10 | 10 | Xs | ✅/❌ |
| 并行 health+status+jobs | 3 | Xs | ✅/❌ |

结论：...

## 上下文窗口

| 测试 | 文件大小 | 总结质量 | 上下文保持 |
|---|---|---|---|
| ... | ... | ... | ... |

结论：实际可用上下文 ≈ XX KB

## 响应体积

| 端点 | 响应大小 | truncation | ChatGPT 展示完整性 |
|---|---|---|---|
| ... | ... | ... | ... |

结论：...

## 综合任务

| 指标 | 结果 |
|---|---|
| 总耗时 | Xs |
| 步骤完整性 | 7/7 或 ... |
| 是否有编造 | 是/否 |
| 提交验证 | git log 确认 |
```

---

## 7. 探测后行动

根据探测结果调整：

1. **超时 < 30s** → `runShell` 改为异步 job 模式
2. **上下文 < 50KB** → GPT 指令中强调分页策略
3. **ChatGPT 编造结果** → 增加 verification 步骤提示
4. **速率太慢** → 优化 GPT 指令减少不必要的 API 调用
