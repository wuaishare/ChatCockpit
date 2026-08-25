# ADR-004: MCP 工具面治理与显式专业能力包

- Status: Accepted
- Date: 2026-08-25
- Scope: Remote MCP model-visible catalog

## Context

ChatCockpit 的内部控制平面能力已经明显超过普通一次开发接管所需的工具集合。P0.1 后生产配置完整 MCP 目录为 83 个工具；P0.2 新增 `chatcockpit.tools.discover` 后，当前配置完整面为 84 个工具，潜在完整分类为 87 个工具（包含 3 个条件注册的 Runtime Resource mutation tools）。

内部 capability 数量继续增长是正常的，但把所有能力默认平铺给模型，会把普通开发、Host 管理、Codex Native、Runtime 管理、Recovery 和 Continuity Governance 混在同一选择层级。

把全部能力反向压成一个 `execute(anything)` 万能 RPC 同样不可接受，因为会削弱输入/输出类型、MCP annotations、审批边界、幂等、审计与领域语义。
## Decision

1. **能力库存与默认工具面分离。** Application Services、REST/Web、Provider-native Runtime 的能力事实不因 MCP 默认可见性变化而删除。
2. **canonical `/mcp` 使用小型稳定 Core。** 当前默认 Core 为 16 个面向普通开发流程的工具，覆盖项目/设备选择、文件/搜索/命令/Git、Trajectory、Continuity Capsule 与工具发现。
3. **专业能力通过显式 Pack 暴露。** 当前 Pack 为 `capability-routing`、`host-admin`、`device-admin`、`workflow`、`continuity-governance`、`codex-native`、`runtime-admin`、`recovery`。
4. **完整面只作为兼容 surface。** `/mcp/full` 保留当前完整能力；0.2.x `/tokenpilot/mcp` 继续作为 receive-only full-surface compatibility alias。
5. **发现不等于动态注入。** `chatcockpit.tools.discover` 只返回 Pack 元数据、endpoint 和专业工具列表。服务端不伪造 MCP 未定义的“调用后动态改变 tools/list”机制。
6. **Compatibility alias 不进入专业 Pack。** 旧 `codex.session.*` / `codex.turn.*` 等别名只留在完整兼容面，Codex Pack 只提升 native `codex.thread.*` 路径。
7. **默认 Core 必须有正式输出契约。** Core 工具 16/16 声明并由服务端实际校验 `outputSchema`；新增或实质修改的 public MCP tools 继续遵守 ADR-003。
## Consequences

- ChatGPT 默认连接面对的 catalog 从 83/84 个平铺工具收敛到 16 个 Core，降低普通开发任务的选择噪声。
- 高级能力仍可显式发现并通过独立 MCP endpoint 使用，不会因为默认隐藏而静默消失。
- 客户端如果支持 Tool Search、allowed-tools 或其他延迟加载机制，可以在服务端 compact surface 之上继续优化；ChatCockpit 不依赖这些客户端能力才获得基本可用性。
- 同一 OAuth `chatcockpit:mcp` 权限可用于 Core、Pack 和 Full MCP surfaces，但不会扩大普通 REST Control Plane 权限。
- Integrations/health 中的 canonical MCP catalog metadata 以默认 Core 为准；完整兼容面的数量不是默认模型可见性指标。

## Rejected alternatives

- **继续默认平铺完整目录：** 能力完整，但模型选择成本和工具说明上下文持续膨胀。
- **单一万能路由工具：** 数量最小，但牺牲类型、安全、审批和可审计性。
- **服务端私有动态 Pack 协议：** MCP 没有对应标准语义，会让客户端兼容性依赖 ChatCockpit 私有行为。
- **一次性迁移全部 legacy outputSchema：** 改动面过大且与默认工具面治理耦合；延迟工具按领域逐步迁移更可审查。

## Verification

P0.2 必须证明 canonical `/mcp`、`/mcp/full` 与至少一个 specialist Pack 的真实 `tools/list`；`tools.discover` 的数量与实际 surface 一致；默认 Core 16/16 存在并通过真实 `outputSchema` validation；REST/Web/native runtime 能力不因 MCP 默认可见性收敛而丢失。
