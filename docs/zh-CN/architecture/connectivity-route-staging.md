# Connectivity 候选 Route 暂存

ChatCockpit 将**当前 canonical Public Endpoint**与任何尚在评估中的未来 Route 严格分离。用户可以暂存一个候选 HTTPS origin，而不改变正在工作的 Runtime 公网 origin、OAuth issuer、OpenAPI/MCP URL、接入组件 Service 状态或 Tunnel 状态。

## 当前真源

canonical 公网 origin 继续以 Runtime 配置 `CHATCOCKPIT_PUBLIC_BASE_URL` 为权威真源。Candidate Route 状态不是第二套 canonical 配置源。

候选 Store 只在 Runtime state 目录中以 `0600` 权限持久化候选记录。每次生成公开 Route Snapshot 时都会实时读取 canonical origin，绝不会把当前 canonical origin 复制进候选状态文件。

## 当前已实现的候选生命周期

当前实现已经把暂存与验证拆成独立阶段：

`读取 current/candidate → 暂存或替换 candidate → 显式 Verification → 丢弃 candidate`

Verification 只产出证据，不会晋升 candidate，也不会改变 canonical Public Endpoint。

一个候选包含：

- 新生成且不透明的 candidate ID；
- 一个规范化后的 HTTPS origin；
- public-safe 的来源分类（`existing-environment` 或已知 Connectivity Provider identity）；
- 固定状态 **`staged-unverified`**；
- created/updated 时间戳。

每次替换都会产生新的 candidate ID。Verification 必须绑定这个精确 identity，而不能只按 origin 字符串模糊匹配；未来 Cutover 还必须同时绑定仍为 current 的 candidate 与其完全匹配的成功 Verification Artifact。

## 输入边界

候选必须是 HTTPS **origin**，不是任意 URL。暂存层会拒绝：

- 非 HTTPS scheme；
- URL 中嵌入 username/password；
- 非根路径；
- query string；
- fragment；
- 与当前 canonical Runtime origin 完全相同的候选。

暂存阶段**不会执行任何 DNS、HTTP、TLS、OAuth 或 Provider 网络请求**。因此 `staged-unverified` 绝不代表可达、可公网路由、证书有效、认证就绪或 Provider 就绪。

## Authority 与 API

受保护的 Web/Operator Surface 提供：

- `GET /api/connectivity/routes` —— 读取当前 canonical 投影与候选状态；
- `POST /api/connectivity/routes/candidate` —— 暂存或替换候选 Route Intent；
- `DELETE /api/connectivity/routes/candidate` —— 丢弃候选；
- `GET /api/connectivity/routes/verification` —— 读取当前 candidate 对应的 public-safe Verification Artifact（如果存在）；
- `POST /api/connectivity/routes/candidate/verify` —— 对一个精确的 current candidate ID 执行显式验证。

Operator Session 的写操作继续强制使用既有 CSRF 防护。当前仍然**不存在 cutover endpoint**。

## 安全不变量

暂存或丢弃候选绝不能：

- 改写 `CHATCOCKPIT_PUBLIC_BASE_URL`；
- 修改 OAuth issuer 或 audience 配置；
- 修改 OpenAPI 或 MCP 公网端点；
- 启动、停止、安装或重配置 Connectivity Provider；
- 启动或切换 Tunnel；
- 发起任何出站网络请求；
- 销毁或替换当前仍在工作的 Route。

Verification 是本阶段唯一允许执行受限出站请求的操作，但它仍然绝不能修改 canonical Runtime 或 Provider 状态。

## 已实现：Verification

Verifier 消费一个精确的 current candidate ID，并在 Runtime state 目录以 `0600` 权限持久化 Verification Artifact。Artifact 只包含 public-safe 状态、受限 reason code、可选 HTTP status、candidate identity/origin 与时间戳；不会持久化解析到的 IP、响应正文、原始 TLS/网络错误、凭据或 Provider 输出。

网络边界采用 fail-closed 策略：

- 只解析一次 candidate hostname，并检查 DNS 返回的**全部**地址；
- 未解析到地址、地址数量超过 16，或任一结果不是 public unicast 时直接失败；loopback、private、link-local、CGNAT、reserved、multicast、unique-local 等都被拒绝；
- HTTPS 连接固定到已经通过检查的解析 IP，同时保留原始 candidate hostname 用于 TLS hostname verification/SNI，防止第二次 DNS 查询把请求改送到其他地址；
- 保持正常 CA/证书验证（`rejectUnauthorized` 始终启用）；
- 只允许固定 GET 目标：`/api/health` 与 `/.well-known/oauth-protected-resource/mcp`；
- 不跟随 redirect；
- 每个请求最多 5 秒、响应正文最多 64 KiB；
- 只有同时满足预期 ChatCockpit Health contract 与 OAuth protected-resource metadata，Artifact 才能进入 `verified`；两者都必须继续指向实时的 current canonical Runtime origin，通用的“仿 ChatCockpit”响应不能通过 identity verification。

只要 DNS 答案中混入一个非公网地址，就会在任何 HTTPS 请求前失败。Verifier 在持久化 Artifact 前还会重新检查 candidate ID；如果验证过程中 candidate 已被替换，则按 stale 失败且不写入 Artifact。

Verification 失败必须保持 canonical origin 不变。重新暂存或丢弃 candidate 后，旧 Artifact 因 candidate ID 不再匹配而不会继续投影为当前验证结果。

## 更后续阶段：显式 Cutover

Cutover 继续作为独立能力存在。它只能消费仍为 current 的 candidate 与完全匹配的成功 Verification Artifact，并要求显式 Operator Intent；随后通过权威 Machine/Runtime 配置路径更新 canonical Runtime 配置、执行 post-cutover Verification，并保留足够的旧状态证据以支持 rollback。

完整生命周期保持为：

`candidate → verification → explicit cutover → post-cutover verification → rollback on failure`
