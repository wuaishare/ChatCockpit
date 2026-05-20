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
