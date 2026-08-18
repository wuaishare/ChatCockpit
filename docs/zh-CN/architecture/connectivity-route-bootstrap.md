# 首次公网 Route Bootstrap 身份 Proof

从 local-only Runtime 第一次建立 canonical Public Route，不能复用 replacement verification。Replacement verification 证明 candidate 仍然指向一个 Health 与 OAuth Metadata 已经绑定现有 canonical origin 的 Runtime；而 local-only Runtime 尚不存在这层公网身份。

因此 ChatCockpit 在任何首次公网 Machine Mutation 之前，使用独立的 **Bootstrap Identity Proof**。

## 已实现的权限边界

- **Web Cockpit / Operator**：可以针对 exact staged Candidate Public Route 准备、验证、查看或取消 Bootstrap Identity Proof。
- **Runtime**：只有在 proof 处于 active prepared 状态时，才暴露一个短期 proof endpoint。
- **macOS App / CLI Machine Authority**：这是当前唯一实现的首次公网 Bootstrap 执行面。它只消费 exact verified proof、修改 canonical Runtime 公网 origin，并负责必要的 Runtime restart、Bootstrap 后验证与 rollback；不会启动 Provider/Tunnel Service，也不会写 Provider Secret。

当前已实现的受保护 Operator API：

- `GET /api/connectivity/routes/bootstrap-proof`
- `POST /api/connectivity/routes/bootstrap-proof`
- `POST /api/connectivity/routes/bootstrap-proof/verify`
- `DELETE /api/connectivity/routes/bootstrap-proof`

Operator 写操作继续受既有 Session + CSRF 边界保护。

当前明确不存在 `/api/connectivity/routes/bootstrap/execute` 或 `/api/connectivity/routes/bootstrap-proof/execute` endpoint。

## Machine-Local Challenge

准备 proof 必须满足：

- canonical Public Route 仍为空；
- 当前存在 exact Candidate Public Route；
- 请求的 candidate ID 与当前 candidate 完全一致。

Runtime 会生成高熵随机 challenge，并且只保存在 machine-local 的 `connectivity-route-bootstrap-proof.json` 中，文件权限为 `0600`。prepared proof 有效期为 5 分钟。

受保护的 Web 投影只包含 proof ID、candidate identity、生命周期时间、受限 verification 状态，**不包含 challenge 值**。challenge 不会复制进 Provider 配置、Cutover Intent、Web types 或 Verification Artifact。

当 proof 处于 prepared 状态时，Runtime 只在以下 exact public-safe path 暴露 challenge：

`/.well-known/chatcockpit-bootstrap-proof/<proof-id>`

响应使用 `Cache-Control: no-store`。未知、过期、已验证或因 candidate 漂移而失效的 proof ID 都返回 `404`。

## 公网 Route 验证

Bootstrap verification 复用 Candidate Route Verification 已经固化的 hardened network substrate：

- 所有 DNS 结果必须是 public unicast；
- public/private 混合、loopback、link-local、reserved 或其他非公网解析结果全部 fail-closed；
- 最多接受 16 个解析地址；
- HTTPS 请求固定到已经审核过的地址，并强制新连接；
- TLS 证书与 hostname 校验保持启用；
- 不跟随 redirect；
- 请求超时 5 秒；
- Proof 响应正文最大 4 KiB。

Verifier 会通过 Candidate HTTPS origin 请求 exact proof path。只有响应正文与当前机器保存的 challenge **完全一致**，身份验证才成功。

恶意或错误配置的 candidate endpoint 可以从收到的请求路径看到 proof ID，但 ChatCockpit Operator API 不会把 machine-local challenge 返回给它。除非 candidate 真正能够访问同一个 Runtime proof endpoint，否则无法构造正确响应正文。

## Artifact 生命周期

验证失败时，只保存受限 public-safe checks；challenge 在 5 分钟 prepared TTL 内继续可重试。

验证成功时：

1. 保存 public-safe `verified` Bootstrap Verification Artifact；
2. 立即销毁 challenge；
3. proof 生命周期变为 `verified`；
4. 将 verified proof 有效期延长为 15 分钟，供后续 exact Machine Bootstrap execution 使用。

candidate 被替换、canonical origin 出现或 proof 过期，都会使 proof 失效并被移除。verification 执行期间如果 candidate 发生漂移，也绝不会落下成功 Artifact。

## Machine Bootstrap 执行

verified Bootstrap Proof **本身不等于**首次公网 cutover。当前已实现的 App / CLI Machine Bootstrap Executor 只允许在 canonical 仍为空时，消费 exact verified proof 与 exact current candidate。

执行遵循单一受限事务：

1. 在消费 proof 前确认 Runtime lifecycle 状态；
2. 单次消费仍然有效的 exact verified proof；
3. 通过 compare-and-set 将 canonical Runtime public origin 从 `null` 写为 verified candidate；
4. 如果 Runtime 已在运行，则通过固定 lifecycle bridge restart，并针对新的 canonical origin 执行 Bootstrap 后验证；
5. restart 或 Bootstrap 后验证失败时，通过 compare-and-set 将 canonical origin 恢复为 `null`，并恢复正在运行的 local-only Runtime；
6. Bootstrap 后验证成功后，清理已经晋升的 candidate 状态。

已停止的 Runtime 绝不会被自动启动。Machine Authority 可以更新其 canonical 配置，但结果会保持 `succeeded-pending-runtime-verification`，直到用户显式启动 Runtime 并完成后续验证。

Machine Result 只包含受限 public-safe 状态，不包含 lifecycle 原始输出、可执行文件路径、Provider 凭据或可变命令参数。Executor 不会启动 Provider Tunnel，也不会写 Provider Secret。

Web Cockpit 仍然刻意停在 `verified` Bootstrap Proof，不存在 Web execute endpoint；真正执行只属于显式的 App / CLI Machine Authority 操作。
