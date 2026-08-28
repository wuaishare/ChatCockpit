# ADR-005：Project Center 与 Workspace Registry

- 状态：Accepted；0.2 Alpha 实现于 2026-08-29 收口
- 日期：2026-08-28；实现收口：2026-08-29
- 范围：Project / Project Root / Workspace、Codex 本机候选发现、Web Project Center、macOS App
- 上一版 Gate F release-certified baseline：`e97035e82c467b5b4fa580fd3a0932df718cda99`

## 2026-08-29 实现收口修订

后续实现把本 ADR 的早期 Workspace-first 草案进一步收敛为 **ProjectRoot-first Registry**。以下修订覆盖本文后续与之冲突的早期表述：

1. **持久化真源为 schema v3。** v1 / v2 继续确定性读取迁移；下一次受治理写入持久化为 v3。v3 以 `projects + projectRoots + executionWorkspaces` 为 canonical 数据，`defaultRepoId / repoMappings` 只保留读取期兼容投影，不再写回 canonical 配置。
2. **Primary 管理语义落在 Project Root。** Project 可以把 Git Root 或非 Git Root 设为 Primary Root；这不会凭空重写 Execution Workspace 选择。Git Root 可拥有对应 Execution Workspace，非 Git Root 不伪装为 Workspace。
3. **canonical Owner API 为 Root-first。** `/api/projects/:projectId/roots`、`/roots/:rootId/make-primary` 与 `/roots/:rootId/detach` 是新 UI / App 使用的主合同；detach 只解除 Registry/执行授权关联，不删除磁盘目录，并在存在 active ChatCockpit writer authority 时拒绝执行。旧 `/workspaces` attach / make-primary 路由仅作为兼容桥接，其中 Workspace make-primary 的含义是提升其所属 Project Root。
4. **0.2 Alpha Project Cockpit 采用 compact single-page。** 不在本阶段引入一级 Tabs；Project/Root/Workspace readiness、Development context、Attention/Tasks 等权威事实在一个 Project Cockpit 中渐进呈现。旧 Continuity 非 Projects deep links 继续作为兼容入口，但不再出现在 canonical 顶层导航；`/continuity/projects` 收敛到 `/projects`。
5. **Codex discovery 保留 provider-native logical grouping。** 同一个 Codex logical project 的多个 `rootPaths` 在 Project Center 中作为一个发现组呈现，同时仍保留每个 physical Project Root 的独立身份与授权边界。
6. **macOS App 已对齐 Root-first Registry。** Projects surface 通过同一 `project-registry` 合同完成 Add Root、Make Primary 与 Remove Root；Remove 只解绑、不删除文件。App 还可复用 machine-local 一次性登录 grant 直接打开 `/ui/projects` Project Center，而不另造认证通道。
7. **Gate F 已关闭。** clean committed HEAD `e97035e82c46` 完整 `npm run verify:release` exit 0，并通过 `VERIFY_SOURCE_ARCHIVE_OK`、Build Provenance certified 校验和 `VERIFY_RELEASE_DRY_RUN_OK`。该 commit 是本轮 detach/Open Project Center 收口之前的 release-certified 基线；新增收口改动仍须在 clean committed HEAD 上重新通过完整 release gate。

## 背景

ChatCockpit 已经完成 Capability-first 架构迁移：Development Continuity 仍然是重要的开发治理与接力能力，但不再承担顶层产品类别。然而当前 Web UI 仍以 `Continuity Workbench` 作为顶层工作台，并把 Projects、Documents、Tasks、Sessions、Recovery、Handoffs、Evidence、Approvals 平铺在其下。

当前项目接入同样存在结构性错位：

1. 本机配置 v1 只持久化 `repoMappings: repoId -> path`，没有逻辑 Project grouping；
2. `ProjectService.syncConfiguredProjects()` 因此按每个 `repoId` 自动创建一个同名 Project；
3. SQLite 领域层虽然已经支持一个 Project 拥有多个 Workspace，以及 `defaultWorkspaceId`，但该能力没有成为配置真源，也没有完整管理 API；
4. Web `WorkspaceOnboardingDrawer` 只能手工输入绝对 Discovery Root，然后做 depth-1 Git 扫描；
5. Codex App Server Thread 已提供本机 `cwd`，但 ChatCockpit 只把它与已注册 Workspace 匹配，不会把未注册 cwd 作为本机项目候选；
6. macOS App 已有 `NSOpenPanel`、多 Workspace、Make Primary 与 Remove 的基础交互，但仍直接管理 repo mappings，而非逻辑 Project。

这些问题共同导致 Project Cockpit 仍停留在 P0 的三张只读状态卡，无法形成真正的“Project Center → Project Cockpit → Project 内能力”的产品层级。

## 决策

### 1. Project 是一等管理对象

顶层用户对象是 **Project**，不是 Continuity、repoId、Thread 或单个 Workspace。

Project 必须拥有稳定身份、显示名、状态和一个 Primary Workspace。Project 可以绑定多个 Workspace。

```text
Project Center
  └─ Project
      ├─ Primary Workspace
      ├─ Additional Workspaces
      ├─ Development / Codex
      ├─ Tasks & Sessions (Continuity)
      ├─ Capabilities / Resources
      ├─ Activity / Evidence
      └─ Settings
```

### 2. 区分 Project Root 与 Workspace

长期领域模型区分三层：

- **Project**：用户理解的逻辑项目；
- **Project Root**：附加到 Project 的本机目录。至少一个 Primary Root；可以存在额外 Root，Root 不要求一定是 Git 仓库；
- **Workspace**：可执行的 Git checkout/worktree，承载 branch/head/dirty、Writer Lease、Task/Session 等开发执行语义。

0.2 Alpha 的第一阶段先完整支持 **一个 Project 多个 Git Workspace + Primary Workspace**，但配置和 API 命名不得阻碍后续 Project Root 扩展。非 Git 附加目录作为后续兼容扩展，不把它错误伪装成 Workspace。

### 3. machine-local Project Registry 是持久化真源

Project grouping 不能只存在 SQLite，因为 SQLite 是 Continuity/治理状态库，不应成为本机私有目录配置的唯一恢复来源。

用户配置升级为 schema v2，在保留现有 Repo Governance 字段的同时增加稳定 Project grouping：

```json
{
  "schemaVersion": 2,
  "defaultRepoId": "primary",
  "workspaceDiscoveryRoots": [],
  "workspaceAllowlist": [],
  "repoMappings": {
    "primary": { "path": "/private/path" }
  },
  "projects": {
    "chatcockpit": {
      "displayName": "ChatCockpit",
      "primaryRepoId": "primary",
      "repoIds": ["primary"]
    }
  }
}
```

约束：

- 每个 `repoId` 最多属于一个 Project；
- `primaryRepoId` 必须属于该 Project 的 `repoIds`；
- 每个 `repoId` 必须存在于 `repoMappings`；
- 每个 active Project 至少一个 Workspace；
- Project slug 是稳定机器本地身份键；显示名可修改；
- `defaultRepoId` 继续作为 Runtime/兼容默认 repo，不等同于“全局唯一 Project”；
- v1 读取必须无损兼容：每个现有 repo mapping 确定性迁移为一个单 Workspace Project，因此现有用户行为不被突然合并；
- 下一次受治理配置写入可持久化为 v2；不要求用户手工迁移 JSON。

### 4. Allow Roots 只表示发现权限

`workspaceDiscoveryRoots` 只表示本机 Owner 授权 ChatCockpit 在某个目录下做受限发现；它不是 Project，也不是执行 allowlist。

安全边界保持：

- 不允许文件系统根、用户 HOME 根或 ChatCockpit state root；
- 不跟随 symlink escape；
- 扫描有上限；
- 只有显式加入 Project 的精确 Workspace 才进入执行 allowlist；
- 私有绝对路径只允许 machine-local Owner UI / App 使用，Remote MCP 继续只见 Project/Workspace ID 与 repo alias。

UX 上不再要求用户必须先理解 Allow Root 才能添加项目。Project Center 提供高层动作：

- `Add Project…`
- `Add Workspace…`
- `Import from Codex`
- `Manage Discovery Locations`

Discovery Roots 进入高级/发现位置管理，而不是新建项目的唯一入口。

### 5. Codex 作为本机项目候选来源，而非项目真源

Codex App Server Thread 的 raw `cwd` 可以在本机作为候选发现信号。ChatCockpit 增加 machine-local Owner-only 的 Codex workspace candidate discovery：

1. bounded list Threads；
2. 提取 raw cwd；
3. canonicalize，并尝试解析 Git top-level；
4. 按 canonical path 去重；
5. 标记 registered / unregistered；
6. 只在本机 Owner API 返回绝对路径；
7. Remote MCP、普通 Thread Projection、Activity/Event 不暴露 cwd。

这使“Codex 里已经有很多项目”可以一键进入 Project Center 候选列表，同时保持 Codex 不是 ChatCockpit Project Registry 的权威真源。

### 6. Project Center 与 Project Cockpit 恢复两级信息架构

Web 顶层导航从 `Continuity` 收敛为 `Projects`。

#### Project Center

`/projects`

- Project 列表/搜索/状态；
- Primary Workspace 概览；
- Workspace 数量；
- Git/Runtime/Activity 健康摘要；
- Add Project / Import from Codex；
- Advanced: Discovery Locations。

#### Project Cockpit

`/projects/:projectId`

建议一级页签：

- Overview
- Workspaces
- Development
- Tasks
- Capabilities
- Activity
- Settings

Continuity 的 Documents、Sessions、Handoffs、Evidence、Approvals、Recovery 不再作为全局产品一级导航；它们按任务/开发上下文进入 Project Cockpit 的 Tasks / Development / Activity 中。

旧 `/continuity/*` 在 0.2.x 保持兼容重定向，不再作为 canonical UI 路由。

### 7. Project Cockpit 不再只是三张 P0 卡片

现有 `ProjectCockpitOverview` 的三组权威事实继续保留，但只作为 Overview 的一部分：

- Project / Primary Workspace / Git；
- Model-loop Ownership / Codex / Handoff；
- Effective MCP Applicability。

新增 Project-level 管理事实：

- Primary Workspace 与切换；
- Additional Workspaces；
- Workspace health；
- recent Task/Session/Activity；
- Capabilities/Resources summary；
- Project metadata/settings。

所有权威状态继续来自 Application Service；前端不得自行推断 Runtime/Continuity 真相。

### 8. macOS App 与 Web 共用同一 Registry

macOS App 现有 `NSOpenPanel` 是添加本机目录的正确 UX，应复用而不是删除。

但 App 不再维护一套与 Web 不同的“Workspace = Project”语义。其 Add / Make Primary / Remove 操作必须调用或写入同一个 Project Registry 合同。

App 第一阶段目标：

- Projects 设置/入口；
- 选择 Primary Project/Workspace；
- Add Workspace via `NSOpenPanel`；
- Make Primary；
- Remove attachment without deleting files；
- Open Project Center；
- 显示 Runtime/Project 的高层健康状态。

## API / Service 目标合同

第一阶段 machine-local Owner 管理面：

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
POST   /api/projects/:projectId/rename
POST   /api/projects/:projectId/roots
POST   /api/projects/:projectId/roots/:rootId/make-primary
POST   /api/projects/:projectId/roots/:rootId/detach
GET    /api/projects/discovery

# 0.2.x compatibility only
POST   /api/projects/:projectId/workspaces
POST   /api/projects/:projectId/workspaces/:workspaceId/make-primary
```

兼容期可由现有 `/api/continuity/projects` 读取合同转发到同一个 Project Service，但新的 WebUI 不再以 Continuity 命名 Project 管理 API。Provider discovery 的 canonical surface 为 provider-neutral `/api/projects/discovery`；Codex 是其中一个本机 discovery source，而不是 API 命名真源。

涉及本机路径的 create/attach/detach/discovery 必须要求 machine-local Owner。纯 public-safe Project read 可继续服务 Remote MCP/REST。

## 迁移顺序

### Phase 1 — Registry truth

1. user config v2 + v1 deterministic migration；
2. ProjectService 改为按 Project grouping materialize SQLite；
3. 一个 Project 多 Workspace、Primary Workspace 切换；
4. onboarding 可新建 Project 或 attach 到既有 Project；
5. focused migration/domain tests。

### Phase 2 — Discovery UX

1. Codex local candidates；
2. Project Center Add/Import actions；
3. Discovery Locations 降级为 Advanced；
4. App NSOpenPanel 接新 Registry。

### Phase 3 — Web information architecture

1. 顶层 `Projects`；
2. `/projects` Project Center；
3. `/projects/:projectId` Project Cockpit；
4. Continuity 能力迁入 Project tabs；
5. 旧 `/continuity/*` redirect/compatibility。

### Phase 4 — App alignment and release closure

1. macOS App Projects surface；
2. Web/App contract parity；
3. 文档与截图更新；
4. 恢复 Gate F，修复剩余 Device Agent CLI verifier isolation；
5. 从 clean committed HEAD 完整 `verify:release` exit 0。

## 不做的事

- 不把 Codex Thread 当 Project identity；
- 不把 Discovery Root 自动变成执行权限；
- 不通过普通浏览器 `<input type=file>` 伪装可获得 macOS 绝对目录路径；
- 不把 private path 加回 Remote MCP public projection；
- 不为了 UI 方便绕过 Writer Lease、Git/Evidence 或 machine-local authority；
- 不继续扩展 `Continuity Workbench` 作为顶层产品壳。

## 验收标准

- 现有 v1 用户配置无需手工修改即可启动；
- v1 repo mappings 能确定性映射为现有等价 Projects；
- v2 可持久化一个 Project 多 Workspace；
- Primary Workspace 可切换且重启后保持；
- 同一个 physical checkout 不能重复绑定；
- 一个 repoId 不能同时属于多个 Projects；
- Web 不再要求“先手写 Allow Root”才能完成所有项目接入；
- Codex 中存在但 ChatCockpit 未注册的项目可出现在本机 Owner 候选中；
- Project Center 与 Project Cockpit 恢复两级结构；
- Continuity 不再作为 canonical 顶层产品类别；
- macOS App 与 Web 使用同一个 Project Registry；
- Remote MCP 不新增绝对路径泄露。
