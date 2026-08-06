# TokenPilot

[简体中文](./README.md) | English

![TokenPilot hero poster](./docs/assets/tokenpilot-hero-en.webp)

**v0.1.0-alpha: local-first public preview**

TokenPilot is a ChatGPT-first **Development Continuity & Agent Routing Platform**.

**One repo. Multiple AI runtimes. Seamless handoff.**

ChatGPT owns conversation, intent, planning, and review. TokenPilot provides the local-first control plane for Project, Workspace, Task, Session, Writer Lease, Handoff, Evidence, Approval, and Runtime Binding state. Codex App Server and the local Runner provide explicit Codex Session and asynchronous Agent Job execution.

Save tokens, not thinking. Plan first, reduce rework, and ship more effective changes.

The current alpha implements and locally verifies a CLI, Fastify Control Plane, REST/MCP/OpenAPI, Chat Direct routing, Codex Thread Bind/Resume/Fork, explicit Turn/Approval/Interrupt, SQLite continuity state, Writer Lease, structured Handoff and Evidence, Workspace Continuity Snapshot, evidence-governed Task Review/Completion, 36 MCP tools, asynchronous Job/Runner execution, and a Continuity Workbench Web UI.

## What It Does

```text
ChatGPT Native: conversation, reasoning, planning, and review
Chat Direct: ChatGPT owns the model loop; TokenPilot / App Server execute tools
Codex Session: Codex owns an explicit model loop with Thread and Approval state
Async Agent Job: Queue/Runner executes longer work and records artifacts/evidence
```

The capability ladder is:

```text
ChatGPT Native -> Chat Direct -> Codex Session -> Async Agent Job
```

A TokenPilot Task can move between those modes through Writer Lease, Handoff Checkpoint, and Evidence Bundle state. A ChatGPT conversation, Codex Thread, or Runner Job is an adapter identity, not the sole system of record.

## Capability Status

### Implemented

- Local CLI, Fastify Control Plane, REST, MCP, and OpenAPI.
- Chat Direct file, directory, content-search, controlled command, and Git operations with a proven no-`turn/start` invariant.
- Codex Session Thread List/Read/Bind/Resume/Fork plus explicit Turn, Interrupt, command/file Approval, and Event reads.
- SQLite Continuity Engine for Project, Workspace, Task, Session, Runtime Binding, Writer Lease, Handoff, Evidence, Approval, and Runtime Event state.
- Workspace Continuity Snapshot and Web UI for real Writer, Git, Task, Session, Handoff, Evidence, and Approval state, including Prepare/Accept/Fork/Cancel actions.
- File-backed Queue/Runner, `createCodexRun`, optional Worktree, Artifacts, and Evidence for asynchronous jobs.
- 36 MCP tools, evidence-governed Task Review/Completion, exposed-mode Bearer Auth, public-safe projections, history privacy scanning, restart recovery, and source-archive operation without `.git` metadata.

### Experimental

- Connecting ChatGPT through Custom GPT Actions or Remote MCP.
- Codex App Server standalone file and command execution, enabled only after a local capability probe verifies the exact operation.
- Interactive runtime governance through the Continuity Workbench.

### Under validation

- Long-term compatibility across ChatGPT clients, proxies, and public HTTPS entrypoints.
- Cross-mode handoff recovery and long-running behavior across more real repositories.

### Target direction

- A provider adapter layer for more external coding agents.
- A Resource Center for Skills, MCP, Rules, Prompts, Agents, Hooks, and Plugins.
- Deeper Spec/Plan/TDD/SDD/BDD workflows and multi-device control-plane operation.

## Operator UI

The Web UI is a local operator console. Alongside Dashboard, Jobs, Setup Wizard, and GPT Helper, the Continuity Workbench provides stable Projects, Tasks, Sessions, Handoffs, Evidence, and Approvals routes backed by a real Workspace Snapshot with Writer Lease, Git, changed-file, and handoff state.

![TokenPilot GPT Helper configuration](./docs/assets/tokenpilot-gpt-helper-config.webp)

![TokenPilot GPT Actions writeFile proof](./docs/assets/tokenpilot-gpt-actions-writefile.webp)

In auth-required mode, protected data stays hidden until the operator provides a bearer token in the browser session.

## Quick Start

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor
```

See the beginner path in [`docs/deployment/beginner-quickstart.md`](./docs/deployment/beginner-quickstart.md).

Start the paired local control plane and runner on macOS:

```bash
npm run mvp:start
npm run mvp:status
npm run doctor:runtime
```

Open the local operator UI:

```text
http://127.0.0.1:4318/ui
```

For a repeatable local setup, place runtime variables in `.tokenpilot/runtime/server.env`:

```bash
TOKENPILOT_API_TOKEN=replace-with-your-builder-token
TOKENPILOT_EXPOSED=false
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
```

Use `TOKENPILOT_EXPOSED=true` only after you have configured HTTPS and an access token. Keep real domains, reverse-proxy or tunnel settings, bearer tokens, and machine-specific paths out of Git.

## Custom GPT Actions Status

The public OpenAPI contract is available in [`openapi/tokenpilot.openapi.yaml`](./openapi/tokenpilot.openapi.yaml). The placeholder server URL `https://tokenpilot.example.com` is intentionally generic. Replace it with your own HTTPS URL when configuring GPT Builder, and do not commit real domains or bearer tokens to Git.

Custom GPT Actions and Remote MCP remain experimental deployment surfaces, while the local REST/MCP application services, authentication, structured errors, idempotency, and protocol release gates are implemented. Use Chat Direct when ChatGPT should retain the model loop; use explicit Codex Session operations for Thread, Turn, and Approval workflows; use `createCodexRun` for longer asynchronous work.

For Custom GPT creation, Actions schema import, authentication, and public HTTPS/tunnel setup, see:

- [`docs/deployment/gpt-builder-setup.md`](./docs/deployment/gpt-builder-setup.md)
- [`docs/deployment/public-https-tunnel.md`](./docs/deployment/public-https-tunnel.md)

## Task Pack Template

Give this shape to ChatGPT before handing work to Codex:

````md
# Codex Task Pack

## 1. Goal

Describe the concrete problem in one sentence.

## 2. Context

Keep only the context needed for this task.

## 3. Scope

Must inspect:
- path/to/file-a
- path/to/directory-b

May inspect if needed:
- path/to/related-module

Do not modify:
- path/to/unrelated-module
- package manager config
- global theme tokens

## 4. Execution Requirements

1. Confirm the real root cause first.
2. Make the smallest verifiable change.
3. Do not introduce unrelated dependencies.
4. Preserve existing style.

## 5. Verification

```bash
npm run lint
npm run build
npm run test
```

## 6. Acceptance Criteria

- The original symptom is gone.
- Verification commands pass.
- The diff stays inside scope.
- Existing behavior is not broken.
````

## Public Documentation

- Architecture: [`docs/architecture/local-first-control-plane.md`](./docs/architecture/local-first-control-plane.md)
- Continuity Engine: [`docs/architecture/continuity-engine.md`](./docs/architecture/continuity-engine.md)
- Chat Direct / Codex Session ADR: [`docs/architecture/adr-001-chat-direct-and-codex-session-lanes.md`](./docs/architecture/adr-001-chat-direct-and-codex-session-lanes.md)
- Beginner quickstart: [`docs/deployment/beginner-quickstart.md`](./docs/deployment/beginner-quickstart.md)
- GPT Builder setup: [`docs/deployment/gpt-builder-setup.md`](./docs/deployment/gpt-builder-setup.md)
- MCP setup: [`docs/deployment/mcp-setup.md`](./docs/deployment/mcp-setup.md)
- Public HTTPS / tunnel setup: [`docs/deployment/public-https-tunnel.md`](./docs/deployment/public-https-tunnel.md)
- GPT Actions runner loop: [`docs/architecture/gpt-actions-runner-loop.md`](./docs/architecture/gpt-actions-runner-loop.md)
- Web UI and provider strategy: [`docs/architecture/web-ui-and-provider-strategy.md`](./docs/architecture/web-ui-and-provider-strategy.md)
- Web UI MVP plan: [`docs/architecture/web-ui-mvp-plan.md`](./docs/architecture/web-ui-mvp-plan.md)
- Local runtime ops: [`docs/deployment/local-runtime-ops.md`](./docs/deployment/local-runtime-ops.md)
- Files Read API: [`docs/engineering/files-read-api.md`](./docs/engineering/files-read-api.md)
- Public/private artifact governance: [`docs/governance/public-vs-private-artifacts.md`](./docs/governance/public-vs-private-artifacts.md)
- RTK engineering note: [`docs/engineering/rtk.md`](./docs/engineering/rtk.md)

Real domains, reverse-proxy or tunnel settings, bearer tokens, and GPT Builder operating notes are local configuration. Keep them out of Git.

## Roadmap

- [x] Local CLI, pack, manifest, and task pack scaffold
- [x] File-backed job queue
- [x] Local control plane and runner
- [x] OpenAPI draft for GPT Actions and local runner workflows
- [x] Exposed-mode bearer auth
- [x] Local E2E verification
- [x] Local operator Web UI MVP
- [x] `createCodexRun` jobs with runner/Codex execution and public-safe artifacts
- [x] Public-safe filtering for GPT-visible git diffs, commits, and Codex artifacts
- [x] Chat Direct routing and no-Turn boundary probes
- [x] Codex App Server Thread Bind/Resume/Fork and explicit Turn/Approval/Interrupt
- [x] SQLite Continuity Engine, Writer Lease, Handoff, Evidence, and Runtime Events
- [x] Continuity Workbench and Workspace Snapshot
- [x] REST/MCP parity, 36 MCP tools, evidence-governed Task Review/Completion, restart recovery, and no-Git source archive gate
- [x] GPT Actions boundary probes for timeout, context size, and request behavior
- [x] First-task template library under `templates/`
- [x] Beginner examples under `examples/`
- [x] GPT Builder and public HTTPS setup docs
- [ ] Token Optimization Log examples
- [ ] HTTPS / Custom GPT Actions full-loop validation
- [ ] Provider adapter layer
- [ ] Resource Center and deeper Spec/Plan workflows
- [x] First-run setup wizard

## Security And Privacy

TokenPilot intentionally separates public product code from private operator truth.

Do not commit:

- API keys, bearer tokens, cookies, or local session files.
- Real deployment domains, tunnel tokens, private IPs, or internal hostnames.
- Personal absolute paths or machine-specific runtime state.
- `.codex/`, `.tokenpilot/runtime/`, `.servbay/`, generated debug notes, or private planning artifacts.

Before preparing a commit, run:

```bash
npm run verify:web:safety
npm run privacy:scan:history
```

`npm run privacy:scan:history` is intentionally read-only. Existing historical leaks require a reviewed history rewrite and coordinated force-push; a cleanup commit only protects future snapshots.

## Discussion

TokenPilot is an experimental open-source Development Continuity & Agent Routing Platform for auditable handoff across ChatGPT Native, Chat Direct, Codex Session, and Async Agent Job modes, with token-conscious planner/coder/reviewer workflows.

- GitHub Discussions: <https://github.com/wuaishare/TokenPilot/discussions>
- GitHub Issues: <https://github.com/wuaishare/TokenPilot/issues>
- Pull Requests: templates, docs, examples, and tool improvements are welcome.

## Disclaimer

TokenPilot is not affiliated with OpenAI, ChatGPT, Codex, or GitHub. It does not bypass platform limits. It aims to make existing tools easier to use with clear task boundaries, less repeated context, safer local execution, and better review loops.

## References

- OpenAI Codex Web: <https://developers.openai.com/codex/cloud>
- OpenAI Codex Models: <https://developers.openai.com/codex/models>
- Connecting GitHub to ChatGPT: <https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt>
- Using Codex with your ChatGPT plan: <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan>
- Gitingest: <https://gitingest.com/>

## License

[MIT License](./LICENSE)
