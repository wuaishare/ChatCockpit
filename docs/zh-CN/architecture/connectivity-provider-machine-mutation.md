# Connectivity Provider 机器变更合同

ChatCockpit 将**接入组件探测**与**接入组件变更**严格分离。探测到某个连接器二进制不存在，绝不能因此自动安装软件、启动 Service、创建 Tunnel、切换公网 Route 或请求凭据。

本合同定义未来 Provider Adapter 的 Machine Authority（机器权限）边界，同时保持 ChatCockpit 核心产品身份 Provider-neutral。

## 权限归属

- **Web Cockpit / 公网接入**负责 Provider 选择、域名与 Route 意图、公网 Endpoint 检查、Diagnostics 与 staged cutover 工作流。
- **macOS App / CLI**负责 Provider 安装、升级、卸载、本机 Service Mutation 与 Provider 凭据明文输入。
- **Runtime**在 Provider Route 真正配置后，负责权威的执行状态与健康投影。

Provider Secret 必须保持 machine-local。它们绝不能渲染到 Web Cockpit、放入 CLI 参数、写入公开日志或提交到 Git。

## 变更生命周期

任何 Provider 安装、升级或卸载都必须遵循同一套受限流程：

1. **Detect** — 读取当前 public-safe 本机状态；探测不执行任何 Mutation。
2. **Prepare** — Provider-specific Adapter 校验前置条件并生成受限 Mutation Plan；Prepare 不执行 Provider Mutation。
3. **Confirm** — macOS App 明确展示 Provider、动作以及 public-safe 影响摘要，由操作员显式确认。计时器、默认动作、`not-detected` 状态或来自 Web 的请求都不能自动确认 Plan。
4. **Execute** — 只能通过对应 allowlisted Adapter 执行精确的已准备 Provider Action；通用 Shell Command 不能冒充 Provider Adapter。
5. **Re-probe** — 执行后重新读取 Provider 状态并展示真实观测结果；不能仅凭进程 exit code 推断 Mutation 成功。

一个 Plan 只能对应一个明确目的：Prepare 到 Execute 之间 Provider Identity 与 Action 不可变化。如果前置条件或 Provider 状态变化，旧 Plan 必须作废并重新 Prepare。

## 支持动作

Machine Action 词汇保持刻意精简：

- `install`
- `upgrade`
- `uninstall`

Provider Adapter 必须显式声明自己真正实现了哪些动作。没有实现 Adapter 的 Action 在 App 与 CLI 中必须保持不可用。ChatCockpit 不能仅因为探测结果为 `not-detected` 就自动生成安装按钮。

安装 Provider **不等于**创建或启动公网 Tunnel。Provider Binary 生命周期与 Public Route 生命周期是两类独立操作。

## 当前已实现 Adapter

首个已实现的机器侧 Adapter 是 **macOS 上通过 Homebrew 管理 Cloudflare Tunnel `cloudflared` 二进制生命周期**。它的范围被刻意限制为：

- 通过固定版本探测确认 `cloudflared`；
- Prepare 后由操作员显式确认 `install`、`upgrade` 或 `uninstall`；
- Homebrew 执行只允许标准 macOS 绝对路径 `/opt/homebrew/bin/brew` 或 `/usr/local/bin/brew`；
- Package Manager 命令结束后重新探测 `cloudflared`；
- 只有安装或升级结果验证成功后，才记录 machine-local 的 ChatCockpit ownership；
- 只有该 ChatCockpit ownership 仍适用时，才允许升级或卸载。

外部已有的 `cloudflared` 可以继续复用，但保持 unmanaged；ChatCockpit 不会因为探测成功就自动接管。该 Adapter 不安装 Homebrew、不登录 Cloudflare、不创建 Tunnel、不安装或启动 Tunnel Service、不写入 Provider Credential，也不修改「公网接入」Route。

## 优先复用现有环境

ChatCockpit 必须保护操作员已经存在的基础设施：

- 已可用的 Provider 可以直接复用，不需要重新安装；
- 即使检测到相关二进制，也不能因此重写已有 Reverse Proxy 或 Tunnel 配置；
- Uninstall 默认只能移除 ChatCockpit-owned 安装状态；若要执行更广泛的 Provider-native 移除流程，必须由操作员单独选择并明确确认；
- 环境专属的反代配置、真实域名、Token、机器路径与 Tunnel 记录继续属于 local/private artifact。

## 执行安全

Provider Adapter 必须同时满足：

- 固定且 allowlisted 的 executable / argument 构造，不接受任意 Shell Source；
- Provider 支持 stdin、file descriptor、Keychain 或其他更安全 machine-local 机制时，不得把 Secret 放入进程参数；
- 有界 timeout 与有界输出捕获；
- Public Result 只包含 normalized status、version、action outcome 与 public-safe diagnostics；
- Raw stdout/stderr、解析后的 executable path、credential、cookie、auth token 与机器私有路径不能返回 Web Cockpit；
- Mutation 失败或取消不能修改当前已选择的 Public Endpoint；
- Install / Upgrade / Uninstall 绝不能隐式启动 ChatCockpit Runtime Service 或 Provider Tunnel。

## Public Route Cutover 必须独立

Provider Machine Mutation 可以让某个接入组件变得可用，但它不会自动选择 Canonical Public Endpoint。Public Route 创建与切换属于后续 Connectivity Workflow，而且必须先验证 Candidate Route，再替换当前可用 Route。

要求的 Cutover 形态保持为：

`candidate route → reachability / TLS / auth verification → explicit cutover → post-cutover verification → rollback on failure`

在该工作流正式实现前，任何 Provider Machine Action 都必须保持当前 Public Access Route 不变。
