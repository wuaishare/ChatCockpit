import assert from "node:assert/strict";

import type { ContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { McpConnectionRegistry } from "../src/mcp/connection-registry.ts";
import type { OperationalActivityService } from "../src/application/operational-activity-service.ts";
import type { OperationContext } from "../src/application/operation-context.ts";
import type { ProjectService } from "../src/application/project-service.ts";
import { ProjectExecutionObservabilityService } from "../src/application/project-execution-observability-service.ts";
import { RuntimeExecutionObservabilityService } from "../src/application/runtime-execution-observability-service.ts";

const now = "2026-09-04T00:00:00.000Z";
const project = { id: "project_fixture", slug: "fixture", displayName: "Fixture" };
const workspace = { id: "workspace_fixture", repoId: "repo_fixture" };
const tasks = Array.from({ length: 120 }, (_, index) => ({
  id: `task_${index}`,
  workspaceId: workspace.id,
  title: `Task ${index}`,
  status: "in-progress" as const,
  priority: "normal" as const,
  activeSessionId: null,
  updatedAt: now
}));
const processes = Array.from({ length: 120 }, (_, index) => ({
  id: index === 0 ? "builtin_process_fixture_controlled" : `process_${index}`,
  scope: "workspace" as const,
  rootId: "root_fixture",
  workdir: "/fixture",
  command: `echo ${index}`,
  commandHash: `hash_${index}`,
  executorId: "executor_fixture",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: index < 2 ? "session_alpha" : index === 2 ? "session_beta" : null,
  writerLeaseId: null,
  hostAuthorityId: null,
  privatePid: null,
  status: "running" as const,
  exitCode: null,
  staleReason: null,
  evidenceBundleId: null,
  startedAt: now,
  completedAt: null,
  revision: 1
}));

const projects = {  registry: () => ({
    configRevision: "revision_fixture",
    projects: [{ project, workspaces: [workspace], roots: [] }]
  }),
  registryProject: () => ({ project, workspaces: [workspace], roots: [] })
} as unknown as ProjectService;

const activities = {
  list: () => ({
    activities: [],
    counts: { total: 0, active: 0, running: 0, waitingApproval: 0, paused: 0 }
  })
} as unknown as OperationalActivityService;

const repositories = {
  tasks: { listByProject: () => tasks },
  sessions: {
    get: (sessionId: string) => ({
      id: sessionId,
      status: sessionId === "session_beta" ? "completed" : "running"
    })
  },
  directProcessSessions: {
    list: (filter?: { workspaceId?: string }) =>
      filter?.workspaceId
        ? processes.filter((entry) => entry.workspaceId === filter.workspaceId)
        : processes
  }
} as unknown as ContinuityRepositories;

const connections = { list: () => [] } as unknown as McpConnectionRegistry;
const processControl = {
  capabilities: (processId: string) => processId === "builtin_process_fixture_controlled"
    ? {
        input: true,
        resize: true,
        terminate: true,
        tty: true,
        terminalSize: { rows: 32, cols: 120 }
      }
    : {
        input: false,
        resize: false,
        terminate: false,
        tty: false,
        terminalSize: null
      }
};
const context = { now } as OperationContext;
const runtime = new RuntimeExecutionObservabilityService(
  projects,
  activities,
  repositories,
  connections,
  processControl
).snapshot(context);
assert.equal(runtime.tasks.length, 100);
assert.equal(runtime.processes.length, 100);
assert.equal(runtime.counts.activeTasks, 120);
assert.equal(runtime.counts.runningProcesses, 120);
const controlledRuntimeProcess = runtime.processes.find((entry) => entry.id === "builtin_process_fixture_controlled");
const alphaSibling = runtime.processes.find((entry) => entry.id === "process_1");
const betaProcess = runtime.processes.find((entry) => entry.id === "process_2");
const adHocProcess = runtime.processes.find((entry) => entry.id === "process_3");
assert.equal(controlledRuntimeProcess?.scope, "workspace");
assert.equal(controlledRuntimeProcess?.deviceId, "local-device");
assert.equal(controlledRuntimeProcess?.consoleSessionId, "session_alpha");
assert.equal(controlledRuntimeProcess?.sessionStatus, "running");
assert.equal(alphaSibling?.consoleSessionId, "session_alpha");
assert.equal(alphaSibling?.sessionStatus, "running");
assert.equal(betaProcess?.consoleSessionId, "session_beta");
assert.equal(betaProcess?.sessionStatus, "completed");
assert.equal(adHocProcess?.consoleSessionId, "process:process_3");
assert.equal(adHocProcess?.sessionStatus, null);
assert.equal(controlledRuntimeProcess?.revision, 1);
assert.equal(controlledRuntimeProcess?.controls.input, true);
assert.equal(controlledRuntimeProcess?.controls.resize, true);
assert.equal(controlledRuntimeProcess?.controls.terminate, true);
assert.equal(controlledRuntimeProcess?.terminal.tty, true);
assert.equal(controlledRuntimeProcess?.terminal.rows, 32);
assert.equal(controlledRuntimeProcess?.terminal.cols, 120);
assert.equal(alphaSibling?.controls.input, false);
assert.equal(alphaSibling?.controls.resize, false);
assert.equal(alphaSibling?.controls.terminate, false);

const projectSnapshot = new ProjectExecutionObservabilityService(
  projects,
  activities,
  repositories,
  connections
).snapshot(context, project.id);
assert.equal(projectSnapshot.processes.length, 100);
assert.equal(projectSnapshot.counts.activeTasks, 120);
assert.equal(projectSnapshot.counts.runningProcesses, 120);

process.stdout.write("VERIFY_EXECUTION_OBSERVABILITY_COUNTS_OK\n");