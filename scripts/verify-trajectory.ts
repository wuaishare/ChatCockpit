import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.js";
import type { OperationalActivityService } from "../src/application/operational-activity-service.js";
import { ServiceError } from "../src/application/service-error.js";
import { TrajectoryService } from "../src/application/trajectory-service.js";
import {
  trajectoryToolOutputSchema
} from "../src/contracts/continuity-observability.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations
} from "../src/mcp/tool-definition.js";
import { registerMcpTools } from "../src/mcp/register-tools.js";
import { z } from "zod";

const activityId = "session_trajectory_fixture";
const now = "2026-08-25T00:00:00.000Z";

const activity = {
  id: activityId,
  kind: "agent-session" as const,
  scope: "workspace" as const,
  status: "running" as const,
  title: "P0.1 trajectory fixture",
  targetDeviceId: "local-device",
  projectId: "project_fixture",
  workspaceId: "workspace_fixture",
  taskId: "task_fixture",
  repoId: "primary",
  agentSessionId: activityId,
  authorizationGrantId: "must-not-project",
  traceId: "must-not-project",
  workerInstanceId: "must-not-project",
  runtime: {
    bindingId: "binding_fixture",
    runtimeKind: "codex-app-server" as const,
    bindingStatus: "active" as const,
    externalSessionId: "thread_fixture",
    externalRunId: null,
    externalThreadId: "thread_fixture",
    runId: "run_fixture",
    runRevision: 1,
    turnId: "turn_fixture",
    runStatus: "running" as const
  },
  deviceOperation: null,
  job: null,
  directProcessSummary: { total: 1, active: 1, running: 1 },
  latestEvent: null,
  controls: { pause: false, resume: false, terminate: false, interrupt: true, hold: false as const },
  startedAt: now,
  updatedAt: now,
  endedAt: null
};
const event = {
  id: "event_fixture",
  activityId,
  source: "runtime" as const,
  sequence: 7,
  kind: "step-completed" as const,
  category: "item" as const,
  approvalKind: null,
  itemType: "commandExecution",
  code: null,
  controlAction: null,
  resultingState: null,
  processRevision: null,
  deviceAction: null,
  deviceOperationState: null,
  createdAt: now
};

const activities = {
  list: () => ({
    activities: [activity],
    counts: { total: 1, active: 1, running: 1, waitingApproval: 0, paused: 0 }
  }),
  timeline: (requestedId: string) =>
    requestedId === activityId ? { activityId, events: [event] } : null
} as unknown as OperationalActivityService;

const service = new TrajectoryService(activities);
const trajectory = service.read({ activityId, limit: 20 });
assert.equal(trajectory.version, "1");
assert.equal(trajectory.activity.id, activityId);
assert.equal(trajectory.activity.runtime?.externalThreadId, "thread_fixture");
assert.equal(trajectory.events.length, 1);
assert.equal(trajectory.events[0]?.kind, "step-completed");
assert.equal("authorizationGrantId" in trajectory.activity, false);
assert.equal("traceId" in trajectory.activity, false);
assert.equal("controls" in trajectory.activity, false);
assert.equal("controlAction" in trajectory.events[0]!, false);

assert.throws(
  () => service.read({ activityId: "missing", limit: 20 }),
  (error) => error instanceof ServiceError && error.code === "TRAJECTORY_ACTIVITY_NOT_FOUND"
);

const tool = defineMcpTool({
  name: "chatcockpit.trajectory.fixture",
  title: "Trajectory fixture",
  description: "Verify structured output schema plumbing.",
  inputSchema: z.object({ activityId: z.string() }),
  outputSchema: trajectoryToolOutputSchema,
  annotations: readOnlyToolAnnotations,
  handler: () => ({ ok: true, trajectory })
});
assert.ok(tool.outputSchema);
let registeredOutputSchema: unknown = null;
registerMcpTools(
  {
    registerTool: (_name, config) => {
      registeredOutputSchema = config.outputSchema;
      return null;
    }
  },
  [tool],
  () => buildOperationContext({
    actorType: "remote-mcp",
    actorId: "trajectory-verifier",
    requestId: "trajectory-verifier-request",
    publicProjection: true,
    now
  })
);
assert.equal(registeredOutputSchema, tool.outputSchema);

const result = await tool.execute(
  buildOperationContext({
    actorType: "remote-mcp",
    actorId: "trajectory-verifier",
    requestId: "trajectory-execution-request",
    publicProjection: true,
    now
  }),
  { activityId }
);
assert.equal(result.isError, undefined);
assert.equal(result.structuredContent.ok, true);
console.log("trajectory verification passed");
