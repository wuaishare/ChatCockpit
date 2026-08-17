# Connectivity 候选 Route 暂存

ChatCockpit 将**当前 canonical Public Endpoint**与任何尚在评估中的未来 Route 严格分离。用户可以暂存一个候选 HTTPS origin，而不改变正在工作的 Runtime 公网 origin、OAuth issuer、OpenAPI/MCP URL、接入组件 Service 状态或 Tunnel 状态。

## 当前真源

canonical 公网 origin 继续以 Runtime 配置 `CHATCOCKPIT_PUBLIC_BASE_URL` 为权威真源。Candidate Route 状态不是第二套 canonical 配置源。

候选 Store 只在 Runtime state 目录中以 `0600` 权限持久化候选记录。每次生成公开 Route Snapshot 时都会实时读取 canonical origin，绝不会把当前 canonical origin 复制进候选状态文件。

## 当前已实现的候选生命周期

本阶段刻意只实现：

`读取 current/candidate → 暂存 candidate → 替换 candidate → 丢弃 candidate`

一个候选包含：

- 新生成且不透明的 candidate ID；
- 一个规范化后的 HTTPS origin；
- public-safe 的来源分类（`existing-environment` 或已知 Connectivity Provider identity）；
- 固定状态 **`staged-unverified`**；
- created/updated 时间戳。

每次替换都会产生新的 candidate ID。未来 Verification 或 Cutover 必须绑定这个精确 identity，而不能只按 origin 字符串模糊匹配。

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
- `DELETE /api/connectivity/routes/candidate` —— 丢弃尚未验证的候选。

Operator Session 的写操作继续强制使用既有 CSRF 防护。当前暂存阶段**不提供 verify 或 cutover endpoint**。

## 安全不变量

暂存或丢弃候选绝不能：

- 改写 `CHATCOCKPIT_PUBLIC_BASE_URL`；
- 修改 OAuth issuer 或 audience 配置；
- 修改 OpenAPI 或 MCP 公网端点；
- 启动、停止、安装或重配置 Connectivity Provider；
- 启动或切换 Tunnel；
- 发起任何出站网络请求；
- 销毁或替换当前仍在工作的 Route。

## 必须后续独立实现：Verification

未来 Verifier 必须消费一个精确 candidate ID，并在 Cutover 能力存在之前产出 public-safe Verification Result。Verifier 必须防御 SSRF 与 DNS rebinding，包括解析结果指向 loopback、link-local、private 或其他非公网目标的情况；同时需要分别验证 HTTPS/TLS 有效性、预期 ChatCockpit 可达性，以及目标公网用途所需的认证/OAuth 前置条件。

Verification 失败必须保持 canonical origin 不变。只要重新暂存候选，candidate identity 就会变化，旧 Verification Result 必须失效。

## 更后续阶段：显式 Cutover

Cutover 继续作为独立能力存在。它只能消费仍为 current 的 candidate 与完全匹配的成功 Verification Artifact，并要求显式 Operator Intent；随后通过权威 Machine/Runtime 配置路径更新 canonical Runtime 配置、执行 post-cutover Verification，并保留足够的旧状态证据以支持 rollback。

完整生命周期保持为：

`candidate → verification → explicit cutover → post-cutover verification → rollback on failure`
