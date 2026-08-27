import assert from "node:assert/strict";

import { ContinuityCapsuleService } from "../src/application/continuity-capsule-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import type { TrajectoryService } from "../src/application/trajectory-service.js";
import type { WorkspaceContinuityService } from "../src/application/workspace-continuity-service.js";
import {
  continuityCapsuleToolOutputSchema,
  type TrajectoryProjection
} from "../src/contracts/continuity-observability.js";

const now = "2026-08-25T00:00:00.000Z";
const threadId = "01a00000-1111-7222-8333-444444444444";
const syntheticHome = ["", "Users", "fixture-user"].join("/");
const syntheticRepo = `${syntheticHome}/project`;
const session = {
  id: "session_capsule_fixture",
  projectId: "project_capsule_fixture",
  workspaceId: "workspace_capsule_fixture",
  taskId: "task_capsule_fixture",
  title: "Codex capsule fixture",
  mode: "codex-session" as const,
  status: "running" as const,
  activeRuntimeBindingId: "binding_capsule_fixture",
  startedAt: now,
  updatedAt: now,
  endedAt: null,
  revision: 1
};
const binding = {
  id: "binding_capsule_fixture",
  sessionId: session.id,
  workspaceId: session.workspaceId,
  runtimeKind: "codex-app-server" as const,
  externalSessionId: threadId,
  externalRunId: null,
  sourceExternalId: null,
  externalThreadId: threadId,
  sourceThreadId: null,
  relation: "bound" as const,
  status: "active" as const,
  modelProvider: "fixture-provider",
  createdAt: now,
  updatedAt: now,
  revision: 1
};

const handoff = {
  id: "handoff_capsule_fixture",
  taskId: session.taskId,
  sessionId: session.id,
  workspaceId: session.workspaceId,
  fromMode: "codex-session" as const,
  toMode: "chat-direct" as const,
  goal: `Continue ${syntheticRepo} without leaking the local path`,
  completedItems: ["Finished src/feature.ts"],
  pendingItems: [`Review ${syntheticRepo}/src/next.ts`],
  changedFiles: ["src/feature.ts", `${syntheticHome}/private.txt`, "../escape.txt"],
  risks: [`Do not expose file://${syntheticHome}/secrets.txt`],
  nextAction: "Continue from the bounded capsule",
  gitHead: "deadbeef",
  gitBranch: "feature/capsule",
  gitDirty: true,
  diffArtifactId: null,
  evidenceBundleId: "evidence_capsule_fixture",
  status: "ready" as const,
  createdAt: now,
  acceptedAt: null,
  revision: 1
};

const evidence = {
  bundle: {
    id: "evidence_capsule_fixture",
    taskId: session.taskId,
    sessionId: session.id,
    status: "complete" as const,
    requiredItemCount: 1,
    passedItemCount: 1,
    failedItemCount: 0,
    skippedItemCount: 0,
    createdAt: now,
    completedAt: now,
    revision: 1
  },
  verificationState: "verified" as const,
  items: [{
    id: "evidence_item_capsule_fixture",
    bundleId: "evidence_capsule_fixture",
    kind: "test" as const,
    label: "Focused capsule verifier",
    status: "passed" as const,
    required: true,
    command: `cat ${syntheticHome}/.ssh/private-key`,
    exitCode: 0,
    artifactId: null,
    summary: "private summary is not projected",
    startedAt: now,
    completedAt: now,
    createdAt: now
  }]
};

const taskProjection = {
  task: {
    id: session.taskId,
    projectId: session.projectId,
    workspaceId: session.workspaceId,
    specId: null,
    specVersion: null,
    planId: null,
    planVersion: null,
    parentTaskId: null,
    title: "Capsule fixture task",
    goal: "Fallback task goal",
    status: "in-progress" as const,
    priority: "normal" as const,
    executionPolicy: "planning-optional" as const,
    activeSessionId: session.id,
    latestHandoffId: handoff.id,
    latestEvidenceBundleId: evidence.bundle.id,
    createdAt: now,
    updatedAt: now,
    revision: 1
  },
  sessions: [session],
  runtimes: [{ sessionId: session.id, binding, job: null }],
  latestHandoff: handoff,
  evidence,
  executionPolicy: {} as never,
  completion: { eligible: false, blockers: [] }
};

const snapshot = {
  project: {
    id: session.projectId,
    slug: "capsule-fixture",
    displayName: "Capsule Fixture",
    defaultWorkspaceId: session.workspaceId,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    revision: 1
  },
  workspace: {
    id: session.workspaceId,
    projectId: session.projectId,
    repoId: "primary",
    kind: "checkout" as const,
    branch: "feature/capsule",
    headCommit: "deadbeef",
    dirty: true,
    status: "ready" as const,
    createdAt: now,
    updatedAt: now,
    revision: 1
  },
  activeLease: null,
  readOnly: false,
  readOnlyReason: null,
  git: {
    available: true,
    branch: "feature/capsule",
    headCommit: "deadbeef",
    dirty: true,
    changedPaths: ["src/live.ts", `${syntheticHome}/live-secret.txt`],
    unavailableReason: null
  },
  tasks: [taskProjection],
  pendingApprovals: []
};

const trajectory: TrajectoryProjection = {
  version: "1",
  activity: {
    id: session.id,
    kind: "agent-session",
    scope: "workspace",
    status: "running",
    title: `Run in ${syntheticRepo}`,
    targetDeviceId: "local-device",
    projectId: session.projectId,
    workspaceId: session.workspaceId,
    taskId: session.taskId,
    repoId: "primary",
    agentSessionId: session.id,
    runtime: {
      runtimeKind: "codex-app-server",
      externalThreadId: threadId,
      turnId: "turn_capsule_fixture",
      runStatus: "running"
    },
    startedAt: now,
    updatedAt: now,
    endedAt: null
  },
  events: [{
    id: "event_capsule_fixture",
    kind: "step-completed",
    category: "item",
    code: null,
    itemType: "commandExecution",
    createdAt: now
  }],
  limit: 20,
  bounded: true
};

const workspaces = {
  snapshot: () => snapshot
} as unknown as WorkspaceContinuityService;
const trajectories = {
  find: (activityId: string) => activityId === session.id ? trajectory : null
} as unknown as TrajectoryService;

const service = new ContinuityCapsuleService(workspaces, trajectories);
const context = buildOperationContext({
  actorType: "remote-mcp",
  actorId: "capsule-verifier",
  requestId: "capsule-verifier-request",
  publicProjection: true,
  now
});
const capsule = service.generate(context, {
  workspaceId: session.workspaceId,
  taskId: session.taskId,
  trajectoryLimit: 20
});
assert.equal(capsule.version, "1");
assert.equal(capsule.source.modelLoopOwner, "codex");
assert.equal(capsule.source.runtime?.id, threadId);
assert.equal(capsule.source.runtime?.deepLink, `codex://threads/${threadId}`);
assert.deepEqual(capsule.git.changedPaths.sort(), ["src/feature.ts", "src/live.ts"]);
assert.match(capsule.objective ?? "", /\[local-path-hidden\]/);
assert.match(capsule.pendingItems.join("\n"), /\[local-path-hidden\]/);
assert.match(capsule.risks.join("\n"), /\[local-path-hidden\]/);
assert.match(capsule.trajectory?.title ?? "", /\[local-path-hidden\]/);
assert.equal(capsule.verification.state, "verified");
assert.equal(capsule.verification.items[0]?.label, "Focused capsule verifier");
assert.match(capsule.markdown, /ChatCockpit Continuity Capsule v1/);
assert.match(capsule.markdown, new RegExp(`codex://threads/${threadId}`));
assert.equal(JSON.stringify(capsule).includes(syntheticHome), false);
assert.doesNotMatch(JSON.stringify(capsule), /id_ed25519/);
assert.doesNotMatch(JSON.stringify(capsule), /private summary/);

const workspaceOnlyCapsule = service.generate(context, {
  workspaceId: session.workspaceId,
  trajectoryLimit: 20
});
assert.equal(workspaceOnlyCapsule.source.modelLoopOwner, "unknown");
assert.equal(workspaceOnlyCapsule.source.sessionId, null);
assert.equal(workspaceOnlyCapsule.source.sessionMode, null);
assert.equal(workspaceOnlyCapsule.source.activityId, null);
assert.equal(workspaceOnlyCapsule.source.runtime, null);
assert.equal(workspaceOnlyCapsule.objective, null);
assert.deepEqual(workspaceOnlyCapsule.completedItems, []);
assert.deepEqual(workspaceOnlyCapsule.pendingItems, []);
assert.deepEqual(workspaceOnlyCapsule.risks, []);
assert.equal(workspaceOnlyCapsule.nextAction, null);
assert.equal(workspaceOnlyCapsule.verification.state, "missing");
assert.deepEqual(workspaceOnlyCapsule.verification.items, []);
assert.equal(workspaceOnlyCapsule.trajectory, null);
assert.deepEqual(workspaceOnlyCapsule.git.changedPaths, ["src/live.ts"]);

const parsed = continuityCapsuleToolOutputSchema.safeParse({
  ok: true,
  capsule
});
assert.equal(parsed.success, true);
assert.throws(
  () => service.generate(context, {
    workspaceId: session.workspaceId,
    taskId: "missing-task",
    trajectoryLimit: 20
  }),
  (error) => error instanceof ServiceError && error.code === "CONTINUITY_CAPSULE_TASK_NOT_FOUND"
);
assert.throws(
  () => service.generate(context, {
    workspaceId: session.workspaceId,
    activityId: "missing-activity",
    trajectoryLimit: 20
  }),
  (error) => error instanceof ServiceError && error.code === "CONTINUITY_CAPSULE_ACTIVITY_NOT_FOUND"
);

console.log("continuity capsule verification passed");
