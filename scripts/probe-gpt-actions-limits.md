# GPT Actions 边界探测指南

将此文档直接发送给已配置好 TokenPilot Actions 的 ChatGPT，让它自行执行探测。

---

## 发给 ChatGPT 之前，你先做的准备

1. **确认服务运行**：TokenPilot 已通过 HTTPS 暴露，`TOKENPILOT_API_TOKEN` 已设置
2. **确认 GPT 已导入最新 schema**：去 Custom GPT 的 Actions 页面，从 `https://tokenpilot.example.com/openapi.yaml` 重新导入
3. **确认 GPT 已配置 Auth**：Actions 的 Authentication 选 "API Key" → "Bearer"，填入你的 `TOKENPILOT_API_TOKEN`
4. **确认 GPT 已粘贴最新指令**：从 `https://tokenpilot.example.com/ui/gpt-helper` 复制最新指令粘贴到 GPT 的 Instructions
5. **创建测试文件（可选，用于上下文探测）**：
   ```bash
   mkdir -p /path/to/tokenpilot/test
   # 创建 5KB 文件
   python3 -c "print('x' * 5000)" > /path/to/tokenpilot/test/size-5kb.txt
   # 创建 20KB 文件
   python3 -c "print('x' * 20000)" > /path/to/tokenpilot/test/size-20kb.txt
   # 创建 50KB 文件
   python3 -c "print('x' * 50000)" > /path/to/tokenpilot/test/size-50kb.txt
   ```
6. **（重要）综合任务在独立分支上跑，避免污染工作区**：
   ```bash
   git -C /path/to/tokenpilot checkout -b probe-test
   ```

---

## 下面这段，直接复制发给 ChatGPT

---

> 请帮我完成一系列 TokenPilot API 边界探测。这是对 GPT Actions 调用能力的自测，不是开发任务。
>
> 先执行 health 确认连通性。如果失败，报告错误并停止。
>
> ---
>
> ## 探测一：超时边界
>
> 用 runShell 执行 node 来模拟不同延迟。依次执行以下命令，每步完成后报告耗时：
>
> 1. `command: "node", args: ["-e", "const d=Date.now();while(Date.now()-d<3000);console.log('3s done')"]`
> 2. `command: "node", args: ["-e", "const d=Date.now();while(Date.now()-d<10000);console.log('10s done')"]`
> 3. `command: "node", args: ["-e", "const d=Date.now();while(Date.now()-d<20000);console.log('20s done')"]`
> 4. `command: "node", args: ["-e", "const d=Date.now();while(Date.now()-d<30000);console.log('30s done')"]`
>
> 如果某步超时失败，记录超时时间点，之后的更长延迟不必再试。
>
> ---
>
> ## 探测二：速率限制
>
> 串行测试：连续调用 health 10 次，每次收到结果后立刻发下一次。报告是否全部成功、总耗时、平均间隔。
>
> 并行测试：同时调用 health、getGitStatus（repoId=tokenpilot）、listJobs。报告是否三者都成功了、各自响应时间。
>
> ---
>
> ## 探测三：上下文窗口
>
> 方法 A：读取 test/ 下我们准备好的文件（如果 test/ 不存在则跳过）：
> - 读 test/size-5kb.txt，总结内容
> - 读 test/size-20kb.txt，总结内容
> - 读 test/size-50kb.txt，总结内容
>
> 观察自己：在哪一步总结开始变模糊？
>
> 方法 B：累积读取测试
> - 依次读取 src/types.ts、src/server/app.ts、src/core/config.ts
> - 读完后，告诉我这三个文件各自定义的导出类型/函数名称（从记忆中回答，不要重新读取）
>
> 观察自己：是否能准确回忆？
>
> ---
>
> ## 探测四：响应体积
>
> 1. 用 searchCode 搜索 `pattern: "."`，`path: "src/"`, `maxResults: 40`
>    - 报告是否返回了 `truncated: true`，以及实际匹配数
>
> 2. 用 listDirectory 列出 `path: "src/"` 
>    - 报告返回了多少条目，是否完整
>
> 3. 用 getGitDiff（repoId=tokenpilot）
>    - 报告 diff 大小、是否 `truncated`
>
> ---
>
> ## 探测五：综合写任务（在独立分支 probe-test 上执行）
>
> 先确认：用 getGitStatus 确认当前分支是 probe-test。如果不是，停止并告知我先切分支。
>
> 然后执行以下任务链，每步成功后报 "✅ 步骤N完成"，失败则报 "❌ 步骤N失败: 原因"：
>
> 1. listDirectory `path: "src/core/"` — 看有哪些模块
> 2. searchCode `pattern: "TODO"`, `path: "src/"` — 找到代码中的 TODO
> 3. 如果找到结果，readFiles 读第一个文件，报告文件路径和包含 TODO 那行内容
> 4. （不实际修改，只报告）告诉我你会怎么 editFile 来改掉这个 TODO
>
> **注意：步骤 1-3 是只读的，步骤 4 只报告不执行。此轮探测不产生任何 commit。**
>
> ---
>
> 全部完成后，用一段话总结你在各维度上观测到的边界。回答格式：
>
> - 超时边界：XXX 秒内成功，超过 XXX 秒失败
> - 速率：串行 X 次总耗时 Xs；并行是否成功
> - 上下文：能稳定处理大约 XXX 大小的文件/上下文
> - 响应体积：最大返回了 XXX 条/字节能正常消费
> - 综合任务：步骤 1-4 状态汇总
> - 其他观察：（任何异常、编造、截断、忘记上下文等）

---

## 探测后你做什么

把 ChatGPT 的回答（特别是最后的总结段）复制到 `docs/proof/gpt-actions-limits-report.md`。

根据结论调整：

| 发现 | 对应改动 |
|---|---|
| 超时 < 25s | `runShell` 上限从 30s 降到 25s，长任务走 createCodexRun |
| 上下文 < 50KB | GPT 指令中强化分页策略 |
| ChatGPT 编造结果 | GPT 指令中加"不确定就说不知道"规则 |
| 并行调用失败 | GPT 指令中去掉并行建议 |
| 串行间隔 > 3s | 接受现状，告知用户复杂任务走 createCodexRun |
