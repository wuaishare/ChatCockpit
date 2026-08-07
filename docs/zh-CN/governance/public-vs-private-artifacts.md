# 公共与私有产物边界

## 目的

公开 `TokenPilot` 仓库只保存用户和贡献者需要的产品真源；维护者内部知识、真实部署运维和 Secret 分别进入私有治理面或纯本地状态。

## 可以进入公开仓库

- `src/` 下的产品源码
- `scripts/` 下可复用且 provider-neutral 的验证/构建脚本
- `openapi/` 公共 API 合同
- 当前架构与协议合同
- 用户与贡献者文档
- 使用占位域名和通用路径的部署示例
- 已经过 public-safe 审查的 Proof / Release 资料
- [`product-principles.md`](./product-principles.md) 这类稳定的公开产品原则

## 应进入私有维护者治理仓库

- 内部执行计划、Agent Plan / Spec
- Decision Evolution 与被否决路线的完整推理
- Competitive Intelligence、Reference Source 评估与 ECDE Challenge Card
- Commercial Strategy 与尚未发布的未来产品分支
- 真实部署域名、反向代理、Tunnel 与环境特定运维档案
- GPT Builder 操作记录、内部 Review / Acceptance 记录
- 环境特定但值得版本化保存的恢复与修复流程

这些内容即使不包含 Secret，也不属于 OSS 产品合同。

## 只应保留在本地，不应进入任何 Git

- API Key、Bearer Token、Cookie
- `.tokenpilot/runtime/server.env`
- 原始 Auth / Session 状态
- 未脱敏的本机调试导出
- 其他实时凭据或敏感运行态

## 当前约定

- 公开文档使用 `https://tokenpilot.example.com` 等占位值。
- `.codex/`、`.servbay/`、`.tokenpilot/`、`docs/superpowers/` 等本机/Agent 状态不进入公开 Git。
- 维护者可以在本地使用 `.ops-private` 软链接访问私库，但该入口只写入 `.git/info/exclude`，不得提交；TokenPilot 的路径与 Bundle 安全边界也必须拒绝它。
- HTTP / MCP / Git / Artifact 公共投影不能回显真实部署域名、本机路径或私有治理内容。

## 提交与发布门禁

```bash
npm run verify:knowledge-boundary
npm run verify:web:safety
npm run privacy:scan:history
```

`verify:knowledge-boundary` 防止内部计划、决策演进和已迁移的历史策略文档重新进入公开树；`verify:web:safety` 检查当前工作树的隐私泄漏；`privacy:scan:history` 检查所有可达 Git 历史。

## 历史泄漏处理

如果真实私有信息或本不应公开的维护者知识已经进入历史，普通 `git rm` 只能修复未来快照。需要在完整备份后使用经过审查的 history rewrite，并确保所有公开 branch/tag 都不再指向旧对象，再协调 force push。

## 一句话规则

> 公库发布可复用的产品知识；私库保存维护者大脑；Secret 永远留在 Git 之外。
