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

## 2026-08-28 Amendment: ChatGPT 冻结工具快照与有界 Continuity 调用

后续真实 ChatGPT dogfood 证明了一个客户端治理边界：已批准的 ChatGPT MCP App 使用管理员审核过的工具与输入快照，服务端新增 Tool 或修改 Tool definition 不会自动进入既有 App action surface。MCP `notifications/tools/list_changed` 是协议级能力，但不能被 ChatCockpit 用来绕过 ChatGPT 的 Workspace Action Control、管理员 Refresh 与重新审核流程。

因此 ADR-004 的“拒绝单一万能路由工具”继续成立，并增加以下约束：

1. canonical `/mcp` 可以提供**域内有界 consolidation action**，但不得提供 `execute(anything)` / `tools.invoke(anything)` 一类跨域万能 dispatcher。
2. 当前增加 `chatcockpit.continuity.invoke`，仅用于 Continuity Task / Session / Evidence / Handoff 的 9 个显式操作：`task.create`、`task.get`、`session.start`、`session.get`、`evidence.record`、`handoff.prepare`、`handoff.accept`、`task.submitReview`、`task.complete`。`handoff.prepare/accept` 是 `task.complete` 的 accepted-handoff completion policy 所必需的同域依赖，不属于跨域能力扩张。
3. `continuity.invoke.tool` 必须是公开 JSON Schema 中的固定 enum，而不是自由字符串。任何新增可代理操作都必须修改 public action definition、catalog fingerprint 与验证基线，使 Host/Admin 能在 Refresh/Review 中看到范围变化。
4. `host-admin`、`runtime-admin`、`device-admin`、`workflow`、`codex-native`、`recovery` 与 capability mutation 不得通过 `continuity.invoke` 间接调用；这些能力继续保持显式 Pack / 专用 action 边界。
5. `tools.discover(pack, tool)` 可以返回单个 specialist 的 schema/annotations；只有被上述固定 enum 明确允许的 Continuity 工具才标记 `invokeVia=continuity.invoke`，其他 specialist 仍只有显式 Pack 路径。
6. 域内调用继续执行目标 Tool 原有的 Zod input validation、业务权限、幂等和审计逻辑；consolidation action 不复制也不弱化目标服务治理。
7. 截至本修订，生产配置完整面为 91 个工具，canonical Core 为 20 个；潜在完整分类为 94 个（含 3 个条件注册的 Runtime Resource mutation tools）。数量变化本身不得成为扩大默认权限面的理由。

### Amendment verification

- `/mcp` 必须只暴露 20 个 Core，且 `continuity.invoke` 有正式 `outputSchema`。
- `continuity.invoke.tool` 的 schema 必须只包含上述 9 个 enum 值，并覆盖 `task.complete` 所需的 `handoff.prepare/accept` 同域前置链路。
- `evidence.record` 必须能通过 `continuity.invoke` 实际写入并验证 idempotent replay。
- `runtime.restart`、`devices.runtime.lifecycle.execute`、`host.command.execute` 等跨域高风险工具必须在公开输入 schema 层直接被拒绝，不能进入 dispatcher handler。
- ChatGPT App 工具快照变化仍由 ChatGPT 管理员 Refresh/Review 流程负责；ChatCockpit 不通过私有协议或万能 dispatcher 绕过该治理边界。

## 2026-08-29 Amendment: 有界自举治理扩展

真实 self-bootstrap dogfood 暴露了 2026-08-28 Amendment 的一个过窄边界：`chatcockpit.runtime.restart` 本身已经是受限、不可传入任意 command/path/launchctl 参数的专用 Runtime lifecycle action，但它要求调用方持有当前 Chat Direct Session 的 Workspace Writer Lease。若 canonical Core 只能发现 `lease.acquire` / `runtime.restart` 而不能通过现有有界治理入口调用它们，ChatGPT 会陷入“能发现、不能完成治理前置条件，也不能重启自身”的鸡生蛋断点。

因此，本 Amendment **仅 supersede 2026-08-28 Amendment 中关于 `continuity.invoke` 必须恰好 9 个 Continuity 操作、以及 Runtime 一律不可经该入口分派的范围约束**；“不得变成跨域万能 dispatcher”“固定公开 schema”“目标 Tool 原治理逻辑必须完整保留”等原则继续有效。

当前合同为：

1. canonical `/mcp` 仍保持 20 个 Core，不为自举额外平铺高权限 Tool。
2. `chatcockpit.continuity.invoke` 的公开 discriminated union 扩展为 **13 个固定 variant**：
   - 11 个 Continuity / Writer-Lease 操作：`task.create`、`task.get`、`session.start`、`session.get`、`lease.acquire`、`lease.release`、`evidence.record`、`handoff.prepare`、`handoff.accept`、`task.submitReview`、`task.complete`；
   - 2 个受限 Runtime lifecycle 操作：`runtime.restart`、`runtime.restart.read`。
3. `lease.acquire/release` 仍执行原 Writer Lease 业务约束；`runtime.restart` 仍要求 active `chat-direct` Session 持有对应 Workspace Writer Lease，并只能触发 ChatCockpit 自己的受治理 Runtime restart contract。
4. `host-admin`、Device lifecycle、Workflow、Recovery、Resource mutation、Capability mutation 与 Codex Native 仍不得经该入口分派；不存在任意 tool-name passthrough。
5. `tools.discover(pack, tool)` 对上述 13 个 allowlisted Tool 返回 `invokeVia=continuity.invoke`；其他 specialist 仍保持显式 Pack 边界。
6. ChatGPT 已建立连接可能缓存旧 action schema。服务端更新不会绕过客户端的 Refresh/Review/重新握手治理；旧连接在客户端本地校验阶段拒绝新 variant 属预期兼容边界，而不是服务端私自扩大权限。

### 2026-08-29 verification

- `/mcp` 仍只暴露 20 个 Core。
- `verify:mcp-tool-surface` 固定 11 个 Continuity/Lease + 2 个 Runtime allowlisted variant，并验证它们仍归属于原 specialist pack。
- `verify:mcp` 通过 canonical Core 实际执行 `lease.acquire`，并让 `runtime.restart.read` 穿过 dispatcher 到达 Runtime lifecycle service；Host/Device/Resource mutation 仍在输入 schema 层被拒绝。
- live ChatCockpit dogfood 在 fresh build/restart 后由 `tools.discover` 确认 `runtime.restart` 的 `invokeVia=continuity.invoke`。
- clean HEAD `0c607a5f81c9` 通过完整 `npm run verify:release`，包含 MCP surface、Runtime lifecycle、Source Archive、certified Build Provenance、Web Safety 与 Release Dry Run。

## 2026-08-29 Amendment: 单入口 Codex Native 有界调用

继续以 canonical `/mcp` 做真实 ChatGPT dogfood 后，暴露出另一个入口断点：`project.get` 能投影 Codex Native continuation，`tools.discover` 也能返回 `codex-native` Pack 中 11 个原生动作及其 schema，但这些动作只有 specialist endpoint，没有 canonical Core 调用路径。结果是“ChatGPT → Remote MCP → ChatCockpit → Codex App Server”仍要求额外连接第二个 MCP endpoint，与单一 ChatCockpit 入口的产品目标不一致。

同时审查发现，`project.get` 与 GPT instructions 已长期声明“当前调用方默认持有 model loop，只有用户明确 Delegate/Transfer 到 Codex 才能启动 native Turn”，但原 `codex.thread.turn.start` 的底层执行 schema/service 没有要求任何显式 transfer 声明。这个执行边界漂移必须先于 Core 暴露修复。

因此，本 Amendment **supersede 上一 Amendment 中“生产完整面 91 个工具、`continuity.invoke` 13 个 variant、除 Continuity/Runtime allowlist 外其他 specialist 只能通过独立 Pack 调用”的当前状态描述**；以下“不变原则”继续成立：canonical Core 仍固定 20 个、不得出现任意 tool-name passthrough、目标 Tool 的原 Zod/权限/幂等/审计必须完整执行、ChatGPT action schema 变化仍需客户端 Refresh/Review。

当前合同调整为：

1. canonical `/mcp` **仍保持 20 个 Core**。不增加默认工具预算，而是把原本平铺的只读 `continuity.capsule` 迁回 `continuity-governance` Pack，并让 Core 通过既有 `continuity.invoke` 调用它；腾出的 Core 槽位用于独立 `chatcockpit.codex.invoke`。
2. `chatcockpit.continuity.invoke` 扩展为 **14 个固定 variant**：12 个 Continuity / Writer-Lease 操作（原 11 个加 `continuity.capsule`）+ 2 个受限 Runtime lifecycle 操作。它继续明确拒绝 Codex Native、Host、Device、Workflow、Recovery、Resource/Capability mutation。
3. `chatcockpit.codex.invoke` 是**独立 Codex 域内有界入口**，公开 discriminated union 只允许 11 个 provider-native 动作：`codex.context.read`、`codex.thread.list`、`codex.account.status`、`codex.thread.start`、`codex.thread.resume`、`codex.thread.fork`、`codex.thread.turn.start`、`codex.thread.turn.interrupt`、`codex.thread.approvals.list`、`codex.thread.events.read`、`codex.thread.read`。
4. `codex.invoke` 不包含 `codex.approval.respond`，因为 native approval decision 继续只能由 authenticated local Operator 执行；也不包含 legacy/compatibility `codex.session.*` / `codex.turn.*`，不接收任意 provider method，更不能调用 Host/Device/Runtime/Workflow/Resource 等非 Codex 域动作。
5. `codex.thread.turn.start` 的正式 public schema 与底层 `CodexNativeTurnService.start()` 都要求 `modelLoopTransfer={kind:"operator-explicit", confirmation:"delegate-codex-model-loop"}`。Runtime availability、可恢复 Thread、`project.get` 的 continuation 建议都不能隐式补出这个字段。
6. `modelLoopTransfer` 是**显式调用合同声明**：它用于阻止无 transfer 声明的偶发/隐式 Turn start，并让 schema、idempotency fingerprint 与 public event evidence 都记录这次边界选择；它不是本地人工审批 token，也不能被描述成能够密码学证明远端授权客户端背后的人类自然语言意图。恶意或越权客户端仍由 OAuth、MCP action review 与既有权限治理负责。
7. `tools.discover(pack, tool)` 对上述 11 个 Codex Native allowlist 返回 `invokeVia=codex.invoke`；14 个 Continuity/Runtime allowlist 返回 `invokeVia=continuity.invoke`。其他 specialist 仍返回 `invokeVia=null`。
8. 当前生产配置完整面变为 **92 个工具**；潜在完整分类为 **95 个**（仍含 3 个条件注册的 Runtime Resource mutation tools）；canonical Core 保持 20 个。

### Single-entry Codex verification

- `verify:mcp-tool-surface` 固定 Core=20、Full classification=95、`continuity.invoke` 14 个 allowlisted variant、`codex.invoke` 11 个 allowlisted variant，并验证被代理目标仍属于原 specialist Pack。
- `verify:codex-native-session` 必须证明 native Turn start 携带显式 model-loop transfer，并在 public-safe `turn/requested` event 中记录 `modelLoopTransfer=operator-explicit`。
- `verify:mcp` 必须证明 direct `continuity.capsule` 不再平铺于 Core、Capsule 可经 `continuity.invoke` 调用、Codex Native tool discovery 返回 `invokeVia=codex.invoke`、缺失 `modelLoopTransfer` 的 native Turn 在 provider execution 前被拒绝、跨域 tool name 在 `codex.invoke` 的公开 schema 层被拒绝。
- `codex-native` specialist Pack 与 `/mcp/full` 继续保留原具体 Tool，确保有界 Core consolidation 不删除高级/兼容调用面。

## 2026-08-30 Amendment: 单入口 Continuity 全域可达与前向兼容 envelope

继续使用 canonical `/mcp` 做真实 ChatGPT 长会话 dogfood 后，发现 `continuity-governance` Pack 仍有四个能力无法从单一 Core 入口调用：`continuity.importedContext.read`、`workspace.snapshot`、`handoff.cancel`、`handoff.fork`。其中 `workspace.snapshot` 是恢复长期任务上下文、审计 active writer/task/session/handoff/evidence 状态的核心只读能力；要求调用方为此额外挂载第二个 MCP endpoint，会重新引入“能力存在但当前 ChatGPT 会话不可达”的路由断点。

与此同时，canonical Core 已演进为 24 个工具，生产 Full compatibility surface 为 94 个远程可路由工具；`continuity.invoke` / `codex.invoke` 的公开输入也已从固定 tool-name enum 改为稳定的 `tool + input` envelope。前向兼容来自**公开 envelope 不随 allowlist 扩展而变化**，但运行时仍只接受源码中固定集合，并继续执行目标 Tool 的精确 schema、权限、幂等、审计和风险治理；这不是任意 tool-name passthrough。

因此，本 Amendment supersede 前述 Amendment 中“canonical Core=20”“continuity.invoke 公开 discriminated union 固定 14 variant”“`workspace.snapshot` 等 Continuity specialist 必须另接 Pack”的当前状态描述。历史决策记录保留，但当前合同调整为：

1. canonical `/mcp` 保持 **24 个 Core**；Full compatibility surface 保持 **94 个远程可路由工具**。本次不增加 Core 工具数量。
2. `chatcockpit.continuity.invoke` 使用稳定前向兼容 envelope，服务器端固定 allowlist 扩展为 **18 个目标**：`continuity-governance` Pack 的全部 16 个操作，加 `runtime.restart` / `runtime.restart.read` 两个受限 Runtime lifecycle 操作。
3. 新纳入单入口的四个 Continuity 目标为：`continuity.importedContext.read`、`workspace.snapshot`、`handoff.cancel`、`handoff.fork`。因此正常 Continuity/Writer-Lease/Handoff/Workspace Snapshot 工作不再要求第二个 MCP endpoint。
4. Host administration、Device lifecycle、Workflow、Recovery、Runtime Resource/Capability mutation、Codex Native 仍不得经 `continuity.invoke` 分派；Codex Native 继续使用独立 `codex.invoke`。
5. `tools.discover(pack, tool)` 对全部 16 个 `continuity-governance` 目标以及两个 Runtime lifecycle 目标返回 `invokeVia=continuity.invoke`；其他非 allowlisted specialist 继续返回 `invokeVia=null`。
6. OAuth 设备项目权限按**解析后的真实目标 Tool**递归判定：真正只读目标可使用 read-only；未分类或可变更目标 fail closed 到 project-exec。稳定 gateway 名称本身不能成为权限绕过层。
7. Pack endpoint 与 `/mcp/full` 继续保留原具体 Tool，单入口可达性不会删除 specialist surface，也不会扩大本地 Operator-only 决策能力。

### 2026-08-30 verification

- `verify:mcp-tool-surface` 固定 Core=24，并验证 16 个 Continuity allowlisted suffix 全部仍属于 `continuity-governance` Pack。
- `verify:mcp` 必须证明 `tools.discover` 对新增四个目标返回 `invokeVia=continuity.invoke`，并通过 canonical `/mcp` 实际执行 `workspace.snapshot`。
- OAuth E2E 继续证明 gateway 会按真实内部目标要求 read-only / project-write / project-exec，而不是按 gateway 名称放行。
- live ChatGPT dogfood 在 fresh build/restart 后必须能从当前单一 ChatCockpit 连接直接调用 `workspace.snapshot`，无需额外连接 `continuity-governance` Pack。

## 2026-08-30 Amendment: Full Access 与单连接器 Specialist Gateway

持续 dogfood 进一步证明，只有项目级 `read-only / project-write / project-exec` 仍不足以支撑长期独立远程开发：Host / Device 管理属于另一治理域，且大量 specialist 能力只存在于 Pack endpoint。即使 OAuth 项目权限足够，调用方仍可能因为 Host profile、人工 Host Approval 或“工具不在当前 Core schema”而被迫切换连接器。

本 Amendment supersede 上一节关于“Core=24 / Full=94”“Host / Device specialist 必须另接 Pack”“其他 specialist 的 `invokeVia=null`”的当前合同描述。新的当前合同为：

1. canonical `/mcp` 为 **25 个 Core**；生产 `/mcp/full` 为 **95 个远程可路由工具**。新增的唯一 Core 工具是 `chatcockpit.tools.invoke`。
2. `tools.invoke` 使用稳定 `tool + input` envelope，只允许服务器已分类为 `deferred-pack` 或 `consolidation-candidate` 的 specialist 目标。Core、`operator-only` 与 compatibility-only 工具都不能成为目标，因此它不是任意 tool passthrough。
3. 目标 Tool 仍执行原始精确 schema、目标设备解析、OAuth 权限、Workspace/Writer Lease、Host policy、Approval、审计与幂等治理；gateway 不替目标 Tool 降权。
4. `tools.discover` 对可通过 generic gateway 调用的 specialist 返回 `invokeVia=tools.invoke`；Continuity/Runtime 与 Codex 的既有专用 gateway 继续优先返回 `continuity.invoke` / `codex.invoke`。
5. OAuth 设备权限新增最高档 `full-access`。升级必须由 Owner 显式完成，历史授权不会在 migration 中自动扩大权限；首次授权仍默认 `project-exec` 作为开发推荐档。
6. Host administration 与 Device lifecycle mutation 明确要求 `full-access`。本机 Full Access 是**授权关系 × 设备 × 当前请求**的动态权限，不会永久修改机器全局 Host profile；撤销或降级授权后下一次请求立即失去最高权限。
7. Full Access Host 请求保留精确 prepare/approval revision/hash/audit，只是受信 OAuth 的精确 Host command/mutation 与已启用的 Workspace Host Process intent 可自动进入 approved，避免人工 Web 点击成为远程开发阻塞点。普通 OAuth 与普通 `full-host` profile 的审批和命令限制不变。
8. Full Access 可以获得 public-safe 的 `full-access-host` 根别名来覆盖当前运行用户可访问的 Host 文件系统，绝对本机路径仍不进入 public root list；文件访问仍受根 containment、大小与内容边界约束。
9. Full Access 可使用通用一次性 Host command/解释器。纯 Host 长驻交互进程仍不通过无租约 PID 逃生口开放；项目长驻执行继续使用 `workspace.exec`，Host Managed Process 仍保持 Workspace/Session/Writer Lease 模型。

### Full Access verification

- OAuth E2E 必须证明 `project-exec → tools.invoke(host.roots.list)` 返回 `requiredAccessLevel=full-access`，Owner 升级后同一 canonical `/mcp` 立即成功并投影 `full-access-host`。
- `verify:mcp` 必须证明 `tools.invoke` 可以调用合法 specialist，同时拒绝 `host.command.decide` 等 operator-only 与 `shell.run` compatibility target。
- Host command/mutation/process service tests 必须证明 Full Access 自动批准精确 intent，而普通 remote-mcp 仍不能自行 decision；普通 `full-host` 仍阻止通用 shell interpreter，只有受信 Full Access 请求放开该策略。
- `verify:mcp-tool-surface` 固定 Core=25；生产 MCP smoke 固定 Full=95。
