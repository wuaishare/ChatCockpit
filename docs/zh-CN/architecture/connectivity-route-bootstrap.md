# 首次公网 Route Bootstrap 身份 Proof

从 local-only Runtime 第一次建立 canonical Public Route，不能复用 replacement verification。Replacement verification 证明 candidate 仍然指向一个 Health 与 OAuth Metadata 已经绑定现有 canonical origin 的 Runtime；而 local-only Runtime 尚不存在这层公网身份。

因此 ChatCockpit 在任何首次公网 Machine Mutation 之前，使用独立的 **Bootstrap Identity Proof**。

## 已实现的权限边界

- **Web Cockpit / Operator**：可以针对 exact staged Candidate Public Route 准备、验证、查看或取消 Bootstrap Identity Proof。
- **Runtime**：只有在 proof 处于 active prepared 状态时，才暴露一个短期 proof endpoint。
- **macOS App / CLI Machine Authority**：当前这一片尚不执行首次公网 Bootstrap。Bootstrap Proof 不会修改 `server.env`、restart Runtime、操作 Provider/Tunnel，也不会建立 canonical cutover。

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

## 后续 Machine Boundary

verified Bootstrap Proof **不等于**首次公网 cutover。后续 Machine Bootstrap Executor 仍必须绑定 exact verified proof 与 exact current candidate，确认 canonical 仍为空，只在 Machine Authority 下更新 canonical Runtime 配置，保持 stopped Runtime 不被自动启动，在必要 restart 后执行 post-bootstrap verification，并在事务失败时 rollback 回 local-only。

在 Machine Executor 实现之前，Web Cockpit 会刻意停在 `verified` Bootstrap Proof，不提供任何 execute 控件。
