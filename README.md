# TokenPilot

简体中文 | [English](./README.en.md)

![TokenPilot 项目海报](./docs/assets/tokenpilot-hero-zh-CN.webp)

**v0.1.0-alpha：本地优先公开预览。**

TokenPilot 是以 ChatGPT 为入口的「GPT 直驱 + Codex 异步」双模式协同开发工作流。

ChatGPT 作为大脑与指挥中心，负责上下文管理、任务规划、执行指挥和结果审查；TokenPilot 提供本地优先控制面，负责任务边界、模式路由、状态持久化和 public-safe 产物治理；Codex 是当前接入的异步执行器，用于大型重构与复杂功能开发。

**省 Token，不省思考。谋定而后动，减少返工，有效开发。**

当前版本已经可以本地验证：CLI、Fastify control plane、paired runner、file-backed job queue、OpenAPI、文件读写编辑、代码搜索、白名单 shell、Git 状态 / 差异 / 提交、`createCodexRun`、exposed-mode bearer auth、本地 E2E，以及第一版本地操作员 Web UI。

TokenPilot 默认运行在你的本地开发环境中。连接 Custom GPT Actions 时，请使用你自己的受鉴权 HTTPS 地址；公开仓库只保留占位示例，不提交真实域名、Bearer token、隧道配置或机器路径。

## 它做什么

```text
ChatGPT：规划、上下文管理、指挥、审查
TokenPilot：本地控制面、边界治理、模式路由、状态与产物
GPT 直驱：高频小改动、短验证、public-safe Git 操作
Codex 异步：复杂开发、可选 worktree、diff、artifact、review
```

TokenPilot 的核心链路：

```text
对话 -> 任务边界 -> 模式路由 -> GPT 直驱或 Codex 异步 -> Diff/Artifacts -> Review
```

高频小任务由 ChatGPT 通过文件、搜索、shell、Git API 直驱完成；复杂任务通过 `createCodexRun` 入队，由本地 runner 调用 Codex CLI 执行。未来同一任务边界和产物治理模型也可以扩展到 Claude Code、opencode、reasonix 等更多异步编程工具。

## 当前能力

- 本地 CLI：支持 `pack`、`manifest`、`taskpack`、queue、jobs、server、runner。
- Fastify 控制面：提供 OpenAPI，用于 Custom GPT Actions 实验。
- 本地 file-backed job queue：支持 pack、taskpack、Codex-run jobs。
- Files API：支持 read/write/edit，并对 public-safe 路径做过滤。
- Code Search 与 allowlisted shell：用于短检查和有限本地验证。
- Git API：支持 status/diff/commit，并过滤 GPT 可见输出和自动提交中的敏感路径。
- `createCodexRun`：把较大的任务交给本地 runner 与 Codex CLI。
- 本地操作员 Web UI：查看状态、Jobs、GPT Helper、Artifacts，并控制任务进程。
- Exposed mode：公网或隧道访问时必须启用 bearer auth。
- 隐私门禁：支持当前树安全扫描和历史隐私扫描。

## 操作员 Web UI

Web UI 是本地操作员控制台，用于检查运行状态、查看 jobs、复制 GPT Helper 指令、预览 public-safe artifacts，以及控制 queued/running 任务。

![TokenPilot GPT Helper 配置界面](./docs/assets/tokenpilot-gpt-helper-config.webp)

![TokenPilot GPT Actions 写入文件实测](./docs/assets/tokenpilot-gpt-actions-writefile.webp)

在需要鉴权的模式下，浏览器会话提供 bearer token 前，受保护数据不会展示。

## 快速开始

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor
```

完整新手路径见 [`docs/zh-CN/deployment/beginner-quickstart.md`](./docs/zh-CN/deployment/beginner-quickstart.md)。

macOS 上也可以直接启动本地 control plane 和 paired runner：

```bash
npm run mvp:start
npm run mvp:status
npm run doctor:runtime
```

打开本地控制台：

```text
http://127.0.0.1:4318/ui
```

可重复的本地配置放在 `.tokenpilot/runtime/server.env`：

```bash
TOKENPILOT_API_TOKEN=replace-with-your-builder-token
TOKENPILOT_EXPOSED=false
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
```

只有在你已经配置好 HTTPS 和访问凭据时，才使用 `TOKENPILOT_EXPOSED=true`。

## Custom GPT Actions 状态

公开 OpenAPI 合约位于 [`openapi/tokenpilot.openapi.yaml`](./openapi/tokenpilot.openapi.yaml)。其中的 `https://tokenpilot.example.com` 是占位域名；实际使用时请替换为你自己的 HTTPS 地址，不要把真实域名或 bearer token 提交到 Git。

当前 HTTPS / Custom GPT Actions 全自动闭环仍在验证中。GPT 直驱适合短文件和 Git 操作；更长、更复杂或风险更高的任务，应通过 `createCodexRun` 入队交给本地 runner。

`runShell` 不是 raw shell，但仍是高信任本地命令执行 API。exposed mode 下必须启用 bearer auth，并按需显式开放高信任命令。

创建 Custom GPT、导入 Actions schema、配置鉴权和绑定公网 HTTPS 地址的完整步骤见：

- [`docs/zh-CN/deployment/gpt-builder-setup.md`](./docs/zh-CN/deployment/gpt-builder-setup.md)
- [`docs/zh-CN/deployment/public-https-tunnel.md`](./docs/zh-CN/deployment/public-https-tunnel.md)

## Codex Task Pack 最小模板

把下面结构交给 ChatGPT，再让它为 Codex 生成明确任务包：

````md
# Codex Task Pack

## 1. 目标

用一句话说明要解决的问题。

## 2. 上下文

只保留当前任务必要背景。

## 3. 范围

必须检查：
- path/to/file-a
- path/to/directory-b

必要时可以检查：
- path/to/related-module

禁止修改：
- path/to/unrelated-module
- package manager config
- global theme tokens

## 4. 执行要求

1. 先确认真实根因。
2. 做最小可验证改动。
3. 不引入无关依赖。
4. 保持现有风格。

## 5. 验证

```bash
npm run lint
npm run build
npm run test
```

## 6. 验收标准

- 原问题消失。
- 验证命令通过。
- diff 没有超出范围。
- 既有行为没有被破坏。
````

## 公开文档

- 新手快速开始：[`docs/zh-CN/deployment/beginner-quickstart.md`](./docs/zh-CN/deployment/beginner-quickstart.md)
- GPT Builder 配置：[`docs/zh-CN/deployment/gpt-builder-setup.md`](./docs/zh-CN/deployment/gpt-builder-setup.md)
- 公网 HTTPS / 内网穿透：[`docs/zh-CN/deployment/public-https-tunnel.md`](./docs/zh-CN/deployment/public-https-tunnel.md)
- 本地运行参考：[`docs/zh-CN/deployment/local-runtime-ops.md`](./docs/zh-CN/deployment/local-runtime-ops.md)
- 架构说明：[`docs/zh-CN/architecture/local-first-control-plane.md`](./docs/zh-CN/architecture/local-first-control-plane.md)
- GPT Actions runner loop：[`docs/zh-CN/architecture/gpt-actions-runner-loop.md`](./docs/zh-CN/architecture/gpt-actions-runner-loop.md)
- Files Read API：[`docs/zh-CN/engineering/files-read-api.md`](./docs/zh-CN/engineering/files-read-api.md)
- 公共 / 私有产物治理：[`docs/zh-CN/governance/public-vs-private-artifacts.md`](./docs/zh-CN/governance/public-vs-private-artifacts.md)
- RTK 工程说明：[`docs/zh-CN/engineering/rtk.md`](./docs/zh-CN/engineering/rtk.md)

真实域名、反向代理、tunnel、Bearer token 和 GPT Builder 操作记录属于本地配置，不应提交到 Git。

## 路线图

- [x] 本地 CLI、pack、manifest、taskpack
- [x] file-backed job queue
- [x] 本地 control plane 和 runner
- [x] OpenAPI 草案与 exposed-mode bearer auth
- [x] 本地 E2E 验证
- [x] 本地操作员 Web UI MVP
- [x] `createCodexRun` jobs 与 public-safe artifacts
- [x] GPT 直驱文件、搜索、shell、Git 操作
- [x] 首任务模板库与新手案例
- [x] First-run setup wizard
- [x] 中文 GPT Builder / 公网 HTTPS 配置文档
- [ ] Token Optimization Log 示例
- [ ] HTTPS / Custom GPT Actions 全流程真实验证
- [ ] Provider adapter layer
- [ ] 繁體中文 README

## 安全与隐私

TokenPilot 明确区分公开产品代码和私有 operator 事实。

不要提交：

- API keys、bearer tokens、cookies、local session files。
- 真实部署域名、tunnel tokens、private IP、internal hostnames。
- 个人绝对路径或机器相关运行态。
- `.codex/`、`.tokenpilot/runtime/`、`.servbay/`、生成调试记录或私有规划材料。

提交前至少运行：

```bash
npm run verify:web:safety
npm run privacy:scan:history
```

`npm run privacy:scan:history` 是只读扫描。历史泄露需要经过审查的 history rewrite 和协调后的 force-push；普通清理提交只能保护未来快照。

## 讨论

TokenPilot 是一个实验性开源项目，面向 ChatGPT + Codex 协同、Token-conscious development，以及 Planner / Coder / Reviewer 工作流。

- GitHub Discussions: <https://github.com/wuaishare/TokenPilot/discussions>
- GitHub Issues: <https://github.com/wuaishare/TokenPilot/issues>
- Pull Requests: 欢迎提交模板、文档、示例和工具改进。

## 免责声明

TokenPilot 与 OpenAI、ChatGPT、Codex 或 GitHub 没有关联。它不会绕过任何平台限制，只是用更清晰的任务边界、更少的重复上下文、更安全的本地执行和更好的复盘审查，把现有工具串成可控工作流。

## 参考

- OpenAI Codex Web: <https://developers.openai.com/codex/cloud>
- OpenAI Codex Models: <https://developers.openai.com/codex/models>

## 许可证

[MIT License](./LICENSE)
