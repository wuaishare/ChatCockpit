import fs from "node:fs";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli mock-app-server-1.0.0\n");
  process.exit(0);
}

const workspaceRoot = process.env.TOKENPILOT_MOCK_WORKSPACE_ROOT;
const nestedWorkspaceRoot = process.env.TOKENPILOT_MOCK_NESTED_WORKSPACE_ROOT;
const tracePath = process.env.TOKENPILOT_MOCK_APP_SERVER_TRACE;

if (!workspaceRoot || !nestedWorkspaceRoot) {
  process.stderr.write("mock workspace roots are required\n");
  process.exit(2);
}

function trace(message) {
  if (!tracePath) return;
  fs.appendFileSync(tracePath, `${JSON.stringify(message)}\n`, "utf8");
}

let forkCounter = 0;
let turnCounter = 0;
let approvalCounter = 0;
const pendingApprovals = new Map();
const activeTurns = new Map();
const threads = [
  {
    id: "thread_root",
    preview: "Continue the root workspace task",
    modelProvider: "openai",
    createdAt: 1785970000,
    updatedAt: 1785970100,
    recencyAt: 1785970200,
    cwd: workspaceRoot,
    path: `${workspaceRoot}/.codex/sessions/root.jsonl`,
    instructionSources: [`${workspaceRoot}/AGENTS.md`],
    source: { type: "cli" },
    status: { type: "idle" },
    turns: []
  },
  {
    id: "thread_nested",
    preview: "Review the nested worktree",
    modelProvider: "azure",
    createdAt: 1785960000,
    updatedAt: 1785960100,
    recencyAt: 1785960200,
    cwd: nestedWorkspaceRoot,
    path: `${nestedWorkspaceRoot}/.codex/sessions/nested.jsonl`,
    instructionSources: [`${nestedWorkspaceRoot}/AGENTS.md`],
    sourceKind: "vscode",
    status: { type: "active", activeFlags: ["running"] },
    parentThreadId: "thread_root",
    agentNickname: "Atlas",
    agentRole: "reviewer",
    turns: [{ id: "private_turn", items: [{ text: "private history" }] }]
  },
  {
    id: "thread_outside",
    preview: "Unmapped external workspace",
    modelProvider: "openai",
    createdAt: 1785950000,
    updatedAt: 1785950100,
    recencyAt: 1785950200,
    cwd: "/private/external/project",
    path: "/private/external/.codex/session.jsonl",
    instructionSources: ["/private/external/AGENTS.md"],
    source: "cli",
    status: "notLoaded",
    turns: []
  }
];

function filteredThreads(params) {
  let result = [...threads];
  if (Array.isArray(params.cwd) && params.cwd.length > 0) {
    result = result.filter((thread) => params.cwd.includes(thread.cwd));
  }
  if (typeof params.searchTerm === "string" && params.searchTerm) {
    result = result.filter((thread) => thread.preview.includes(params.searchTerm));
  }
  const limit = Number.isInteger(params.limit) ? params.limit : 25;
  return result.slice(0, Math.max(0, limit));
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
}

function notify(method, params) {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`);
}

function requestClient(id, method, params) {
  process.stdout.write(`${JSON.stringify({ id, method, params })}\n`);
}

function turnRecord(id, status, options = {}) {
  return {
    id,
    items: [],
    itemsView: { type: "complete" },
    status,
    error: options.error ?? null,
    startedAt: options.startedAt ?? 1785970300,
    completedAt: options.completedAt ?? null,
    durationMs: options.durationMs ?? null
  };
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  trace(message);

  if (message.id === undefined) {
    return;
  }

  if (message.method === undefined) {
    const pending = pendingApprovals.get(JSON.stringify(message.id));
    if (!pending) return;
    pendingApprovals.delete(JSON.stringify(message.id));
    notify("serverRequest/resolved", {
      threadId: pending.threadId,
      requestId: message.id
    });
    const decision = message.result?.decision ?? "decline";
    const completed = turnRecord(
      pending.turnId,
      decision === "accept" ? "completed" : "failed",
      {
        completedAt: 1785970310,
        durationMs: 10_000,
        error:
          decision === "accept"
            ? null
            : { code: "MOCK_APPROVAL_DECLINED", message: "Approval declined" }
      }
    );
    activeTurns.delete(pending.threadId);
    notify("turn/completed", {
      threadId: pending.threadId,
      turn: completed
    });
    return;
  }

  switch (message.method) {
    case "initialize":
      respond(message.id, {
        userAgent: "codex_mock_app_server/1.0.0",
        protocolVersion: "2.0",
        capabilities: {
          threadList: true,
          threadRead: true,
          threadResume: true,
          threadFork: true,
          experimentalApi: false
        }
      });
      break;
    case "skills/list":
      respond(message.id, {
        data: [
          {
            cwd: workspaceRoot,
            skills: [
              {
                name: "fixture-skill",
                description: "Fixture Codex skill",
                path: `${workspaceRoot}/.agents/skills/fixture-skill/SKILL.md`,
                scope: "user",
                enabled: true,
                interface: {
                  displayName: "Fixture Skill",
                  shortDescription: "Fixture Codex skill",
                  brandColor: "#123456"
                }
              }
            ],
            errors: []
          }
        ]
      });
      break;
    case "mcpServerStatus/list":
      respond(message.id, {
        data: [
          {
            name: "fixture-mcp",
            authStatus: "unsupported",
            serverInfo: {
              name: "fixture-mcp",
              title: "Fixture MCP",
              version: "1.2.3"
            },
            tools: {
              read_fixture: {
                name: "read_fixture",
                inputSchema: {
                  type: "object",
                  properties: {
                    privatePath: { type: "string", default: `${workspaceRoot}/secret` }
                  }
                },
                annotations: { readOnlyHint: true }
              },
              write_fixture: {
                name: "write_fixture",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: false }
              }
            },
            resources: [],
            resourceTemplates: []
          }
        ],
        nextCursor: null
      });
      break;
    case "plugin/installed":
      respond(message.id, {
        marketplaces: [
          {
            name: "fixture-marketplace",
            path: `${workspaceRoot}/.codex/plugins/fixture-marketplace/marketplace.json`,
            interface: null,
            plugins: [
              {
                id: "fixture-plugin@fixture-marketplace",
                name: "fixture-plugin",
                localVersion: "9.8.7",
                version: null,
                installed: true,
                enabled: true,
                availability: "AVAILABLE",
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                source: {
                  type: "local",
                  path: `${workspaceRoot}/.codex/plugins/fixture-plugin`
                },
                interface: {
                  displayName: "Fixture Plugin",
                  shortDescription: "Installed truth description",
                  category: "Engineering",
                  capabilities: ["Read"]
                }
              },
              {
                id: "installed-only@fixture-marketplace",
                name: "installed-only",
                localVersion: "2.0.0",
                version: null,
                installed: true,
                enabled: true,
                availability: "AVAILABLE",
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                source: {
                  type: "local",
                  path: `${workspaceRoot}/.codex/plugins/installed-only`
                },
                interface: {
                  displayName: "Installed Only",
                  shortDescription: "Installed endpoint only",
                  category: "Engineering",
                  capabilities: ["Read"]
                }
              }
            ]
          }
        ],
        marketplaceLoadErrors: []
      });
      break;
    case "plugin/list":
      respond(message.id, {
        marketplaces: [
          {
            name: "fixture-marketplace",
            path: `${workspaceRoot}/.codex/plugins/fixture-marketplace/marketplace.json`,
            interface: null,
            plugins: [
              {
                id: "fixture-plugin@fixture-marketplace",
                name: "fixture-plugin",
                localVersion: "9.8.7",
                version: "9.9.0",
                installed: true,
                enabled: true,
                availability: "AVAILABLE",
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                source: {
                  type: "local",
                  path: `${workspaceRoot}/.codex/plugins/fixture-plugin`
                },
                interface: {
                  displayName: "Fixture Plugin",
                  shortDescription: "Catalog description wins",
                  category: "Engineering",
                  capabilities: ["Read", "Write"]
                }
              },
              {
                id: "catalog-only@fixture-marketplace",
                name: "catalog-only",
                localVersion: null,
                version: "1.2.3",
                installed: false,
                enabled: false,
                availability: "AVAILABLE",
                installPolicy: "AVAILABLE",
                authPolicy: "ON_INSTALL",
                source: {
                  type: "local",
                  path: `${workspaceRoot}/.codex/plugins/catalog-only`
                },
                interface: {
                  displayName: "Catalog Only",
                  shortDescription: "Catalog endpoint only",
                  category: "Engineering",
                  capabilities: ["Read"]
                }
              }
            ]
          }
        ],
        marketplaceLoadErrors: []
      });
      break;
    case "config/read":
      respond(message.id, {
        config: {
          model_provider: "fixture-provider",
          sandbox_mode: "workspace-write",
          secret_token: "fixture-secret-token",
          desktop: {
            perPath: {
              [workspaceRoot]: "fixture-editor"
            }
          }
        }
      });
      break;
    case "thread/list":
      respond(message.id, {
        data: filteredThreads(message.params ?? {}),
        nextCursor: null,
        backwardsCursor: "mock-backwards-cursor"
      });
      break;
    case "thread/read": {
      const thread = threads.find((candidate) => candidate.id === message.params?.threadId);
      if (!thread) {
        fail(message.id, -32602, "thread not found");
        break;
      }
      respond(message.id, { thread });
      break;
    }
    case "thread/resume": {
      const thread = threads.find((candidate) => candidate.id === message.params?.threadId);
      if (!thread) {
        fail(message.id, -32602, "thread not found");
        break;
      }
      respond(message.id, {
        thread: {
          ...thread,
          status: { type: "idle" }
        }
      });
      break;
    }
    case "thread/fork": {
      const source = threads.find((candidate) => candidate.id === message.params?.threadId);
      if (!source) {
        fail(message.id, -32602, "thread not found");
        break;
      }
      forkCounter += 1;
      const forked = {
        ...source,
        id: `thread_forked_${forkCounter}`,
        preview: `Fork of ${source.preview}`,
        parentThreadId: source.id,
        status: { type: "idle" },
        path: `${source.cwd}/.codex/sessions/forked-${forkCounter}.jsonl`,
        turns: Array.isArray(source.turns) ? [...source.turns] : []
      };
      threads.push(forked);
      respond(message.id, { thread: forked });
      break;
    }
    case "turn/start": {
      const thread = threads.find((candidate) => candidate.id === message.params?.threadId);
      if (!thread) {
        fail(message.id, -32602, "thread not found");
        break;
      }
      turnCounter += 1;
      const turnId = `turn_mock_${turnCounter}`;
      const turn = turnRecord(turnId, "inProgress");
      activeTurns.set(thread.id, turnId);
      respond(message.id, { turn });
      setTimeout(() => {
        if (activeTurns.get(thread.id) !== turnId) return;
        notify("turn/started", { threadId: thread.id, turn });
        approvalCounter += 1;
        const approvalId = `approval_mock_${approvalCounter}`;
        pendingApprovals.set(JSON.stringify(approvalId), {
          threadId: thread.id,
          turnId,
          itemId: `item_command_${approvalCounter}`
        });
        requestClient(
          approvalId,
          "item/commandExecution/requestApproval",
          {
            threadId: thread.id,
            turnId,
            itemId: `item_command_${approvalCounter}`,
            startedAtMs: 1785970305000,
            approvalId: null,
            environmentId: null,
            reason: `Inspect ${workspaceRoot} before continuing`,
            command: `git -C ${workspaceRoot} status`,
            cwd: workspaceRoot,
            commandActions: null,
            networkApprovalContext: null,
            proposedExecpolicyAmendment: null,
            proposedNetworkPolicyAmendments: null
          }
        );
      }, 5);
      break;
    }
    case "turn/interrupt": {
      const turnId = activeTurns.get(message.params?.threadId);
      if (!turnId || turnId !== message.params?.turnId) {
        fail(message.id, -32602, "active turn not found");
        break;
      }
      activeTurns.delete(message.params.threadId);
      respond(message.id, {});
      notify("turn/completed", {
        threadId: message.params.threadId,
        turn: turnRecord(turnId, "interrupted", {
          completedAt: 1785970306,
          durationMs: 6_000
        })
      });
      break;
    }
    default:
      fail(message.id, -32601, `method ${message.method} is not supported`);
  }
});

input.on("close", () => process.exit(0));
