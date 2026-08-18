# Public Route Cutover Intent 合同

Public Route 切换必须拆成 **Operator Intent** 与 **Machine Execution** 两层。这样 Web Cockpit 可以继续拥有公网接入工作流，但不会越权接管本机 Runtime Service。

## 权限边界

- **Web Cockpit / Operator**：只有在 exact Candidate Public Route 已经拥有完全匹配且成功的 Verification Artifact 后，才允许准备或取消短期 Cutover Intent。
- **macOS App / CLI Machine Authority**：已经负责 replacement cutover 的 canonical 配置变更、必要的 Runtime 生命周期动作、post-cutover verification 与 rollback。
- **Runtime**：执行完成后继续作为 canonical Public Endpoint 的权威投影。

准备 Intent **不等于切换**。它不会写 `server.env`、不会 restart Runtime、不会操作 Provider/Tunnel，也不会修改任何凭据。

## 已实现的 Intent 生命周期

当前 Web/Operator 生命周期是：

`verified current candidate → prepare intent → pending-machine-execution → cancel / expire / invalidate`

受保护 API：

- `GET /api/connectivity/routes/cutover-intent`
- `POST /api/connectivity/routes/cutover-intent`
- `DELETE /api/connectivity/routes/cutover-intent`

Operator 写操作继续复用既有 CSRF 防护。

当前明确不存在 `/api/connectivity/routes/cutover`、`/cutover/execute` 或 `/cutover-intent/execute` endpoint。

## Exact Binding

Replacement Cutover Intent 只有在以下条件全部成立时才能生成：

- Runtime 已经存在 canonical Public Endpoint；
- 请求的 candidate ID 正是当前 staged candidate；
- 请求的 verification ID 正是当前 Verification Artifact；
- Artifact 顶层状态为 `verified`，并且五项 verification checks 全部 `ok=true`；
- Artifact 的 candidate ID 与 origin 与当前 candidate 完全一致；
- candidate 与当前 canonical origin 仍然不同。

Intent 会记录 exact candidate ID/origin/source、verification ID，以及 expected current canonical origin，并在 15 分钟后过期。

candidate 被替换、产生新的 Verification Artifact、canonical origin 漂移或 Intent 过期，都会使 Intent 立即失效；失效 Intent 会被清理，而不是继续保持可执行状态。

## Public-Safe Intent State

Intent 以 `0600` 权限保存在 machine-local 的 `connectivity-route-cutover-intent.json` 中。里面不保存 token、password、Provider credential、命令、可执行路径或原始 verification 数据。

它明确声明以下 public-safe 语义：

- `requiresMachineAuthority = true`
- `changesCanonicalOrigin = true`
- `mayRestartRunningRuntime = true`
- `startsStoppedRuntime = false`
- `startsProviderTunnel = false`
- `writesProviderSecrets = false`

Web 可以显示当前 canonical、目标 candidate、Intent 过期时间与“待 Machine Authority 执行”状态。Intent 存在期间，Web 会锁住 candidate 替换、重新验证与丢弃操作，要求先取消 Intent，从同一 Surface 避免误制造漂移。

## Bootstrap 必须独立建模

当前 Intent 合同**只支持替换已有 canonical Public Route**。从 local-only 第一次建立公网 Route 会明确返回 `bootstrap-not-supported`。

原因是 Replacement Verification 依赖一个关键事实：candidate Route 必须能访问到同一个 Runtime，而且 Health/OAuth Metadata 仍然绑定当前 existing canonical origin。local-only Runtime 还没有这个 canonical OAuth identity，如果直接把同一证明规则套到 Bootstrap，就会形成虚假安全保证。

首次公网 Bootstrap 必须先设计独立的 identity proof 与 Machine Authority 合同，不能偷用 replacement cutover。

## 已实现的 Machine Execution 合同

macOS App / CLI Machine Authority 会消费一个 exact 且仍适用的 Cutover Intent，并继续 fail-closed。真正变更前会重新检查 Intent 与 expected current canonical origin，读取 Runtime lifecycle 状态，并且只有 preflight 成功后才消费 Intent。

如果 Runtime 原本正在运行，replacement execution 采用：

`捕获旧 canonical/服务状态 → CAS + 0600 原子更新 server.env canonical → 通过固定 ChatCockpit lifecycle 脚本 restart → 绑定新 canonical 的 post-cutover verification → 清理已晋升 candidate`

如果配置修改后 restart 或 post-cutover verification 失败：

`CAS 恢复旧 canonical → restart 原本运行的 Runtime → 返回 bounded rollback 结果`

公开结果不会返回原始 lifecycle 输出、响应正文、解析地址、可执行路径、Provider credential 或 Secret。CLI 只接受 exact Intent ID，不接受任意 origin、环境变量键、命令、可执行文件或 lifecycle action。

如果 Runtime 执行前处于 stopped，执行后仍保持 stopped。此时 Machine Authority 会在 `server.env` 中原子晋升 candidate origin、消费 Intent、清除旧的 pre-cutover Verification Artifact，并保留 Candidate，返回 `succeeded-pending-runtime-verification`；**不会**启动或 restart Runtime。之后由用户显式启动 Runtime，再对同一个 Candidate 进行验证；只有全部 verification checks 成功后，才完成这次 pending cutover 并清除 Candidate。

Provider Tunnel 生命周期和 Provider Secret 仍属于独立 Machine Workflow，不能因为存在 Cutover Intent 就自动创建、启动或修改。