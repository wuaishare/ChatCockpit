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
  id: `process_${index}`,
  scope: "workspace" as const,
  rootId: "root_fixture",
  workdir: "/fixture",
  command: `echo ${index}`,
  commandHash: `hash_${index}`,
  executorId: "executor_fixture",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: null,
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
  directProcessSessions: {
    list: (filter?: { workspaceId?: string }) =>
      filter?.workspaceId
        ? processes.filter((entry) => entry.workspaceId === filter.workspaceId)
        : processes
  }
} as unknown as ContinuityRepositories;

const connections = { list: () => [] } as unknown as McpConnectionRegistry;
const context = { now } as OperationContext;
const runtime = new RuntimeExecutionObservabilityService(
  projects,
  activities,
  repositories,
  connections
).snapshot(context);
assert.equal(runtime.tasks.length, 100);
assert.equal(runtime.processes.length, 100);
assert.equal(runtime.counts.activeTasks, 120);
assert.equal(runtime.counts.runningProcesses, 120);

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