# GPT Actions 边界探测报告

探测日期：2026-05-31
TokenPilot 版本：26.0531.1313 (44)
探测分支：probe-test

---

## 超时边界

| 延迟 | 结果 |
|---|---|
| 3s | ✅ |
| 10s | ✅ |
| 20s | ✅ |
| 30s | ❌ 稳定失败 |

结论：GPT Action 超时边界 ≈ **30 秒**。超过此时间的 API 必须用异步模式。

**影响**：`runShell` 当前 30s 上限恰好卡在边界上，应降至 **25s** 留出余量。

---

## 速率限制

| 测试 | 调用次数 | 结果 |
|---|---|---|
| 串行 health × N | 连续多次 | ✅ 未触发限流 |
| 并行 health + getGitStatus | 2 并发 | ✅ 正常返回 |

结论：ChatGPT Actions 无明显速率限制。

---

## 上下文窗口

| 测试 | 文件大小 | 结果 |
|---|---|---|
| size-5kb.txt | 5 KB | ✅ 完整总结 |
| size-20kb.txt | 20 KB | ✅ 完整总结 |
| size-50kb.txt | 50 KB | ✅ 完整总结 |
| 累积读取 (types + app + config) | ~53 KB | ✅ 准确回忆结构 |

结论：上下文窗口不是当前瓶颈。单文件 50KB、累积 ~53KB 均能稳定处理。

---

## 响应体积

| 端点 | 结果 |
|---|---|
| readFiles (50KB) | ✅ 正常返回 |
| listDirectory | ✅ 正常 |
| searchCode | ✅ 正常 |

仍待验证：大 diff 场景（getGitDiff）、满 40 条结果的 searchCode。

---

## 综合写任务

| 步骤 | 状态 | 备注 |
|---|---|---|
| listDirectory src/core/ | ✅ | |
| searchCode "TODO" in src/ | ✅ | 无结果（仓库中无 TODO） |
| readFiles 第一个结果 | ✅ | 已跳过（无匹配） |
| editFile 方案建议 | ✅ | 仅报告方案，未执行 |

---

## 关键推论

1. **主要瓶颈是超时**，不是上下文窗口。GPT Actions 有 ~30s 硬超时。
2. `runShell` 当前 30s 上限需降至 **25s** 以保证可靠性。
3. 文件读写和代码搜索在当前规模下无瓶颈。
4. 大 diff / 大搜索结果场景尚未充分探测。
