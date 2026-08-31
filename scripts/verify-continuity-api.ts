import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { classifyMcpToolSurface } from "../src/mcp/tool-surface.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeMcpApplicabilityProjection,
  RuntimeThreadListResult
} from "../src/runtime/codex/runtime-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length ? dataLines.join("\n") : body) as JsonRpcResponse;
}

const unusedCodexMethod = async (): Promise<never> => {
  throw new Error("Continuity API fixture Codex method is not used");
};

const continuityFixtureCodex: CodingRuntimeAdapter = {
  capabilities: async (): Promise<RuntimeCapabilitySnapshot> => ({
    available: true,
    runtime: "codex-app-server",
    binarySource: "chatgpt-app",
    binaryVersion: "codex-cli continuity-api-fixture",
    protocolFamily: "app-server-v2",
    serverProtocolVersion: "2.0",
    stableMethods: ["thread/list", "thread/read", "thread/resume", "thread/fork"],
    experimentalApiEnabled: false,
    standaloneExecution: null
  }),
  listThreads: async (): Promise<RuntimeThreadListResult> => ({
    data: [],
    nextCursor: null,
    backwardsCursor: null
  }),
  readMcpApplicability: async (input): Promise<RuntimeMcpApplicabilityProjection> => ({
    workspaceId: input.workspaceId,
    configuredServerCount: 0,
    applicableServerCount: 0,
    disabledServerCount: 0,
    servers: []
  }),
  readThread: unusedCodexMethod,
  readThreadContext: unusedCodexMethod,
  startThread: unusedCodexMethod,
  resumeThread: unusedCodexMethod,
  forkThread: unusedCodexMethod,
  startTurn: unusedCodexMethod,
  interruptTurn: unusedCodexMethod,
  readAccountStatus: unusedCodexMethod,
  readStandaloneFile: unusedCodexMethod,
  writeStandaloneFile: unusedCodexMethod,
  listStandaloneDirectory: unusedCodexMethod,
  executeStandaloneCommand: unusedCodexMethod,
  respondToServerRequest: unusedCodexMethod,
  rejectServerRequest: unusedCodexMethod,
  setEventSink: () => undefined,
  close: async () => undefined
};

async function runContinuityApiVerification(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-continuity-api-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Continuity API fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "chatcockpit.openapi.yaml"),
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml")
  );

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "continuity-api-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: {
          primary: {
            path: repoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  const originalToken = process.env.CHATCOCKPIT_API_TOKEN;
  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token";
  process.env.CHATCOCKPIT_EXPOSED = "true";

  const app = buildServer(paths, { codexAdapter: continuityFixtureCodex });
  let testServer: Awaited<ReturnType<typeof listenTestServer>> | null = null;
  let requestId = 1;

  try {
    testServer = await listenTestServer(app);
    const baseUrl = testServer.baseUrl;

    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      body?: unknown
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: "Bearer test-token",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = (await response.json()) as T & {
        error?: { code: string; message: string };
      };
      assert.equal(
        response.ok,
        true,
        `REST ${method} ${route} failed: ${JSON.stringify(payload)}`
      );
      return payload;
    };

    const mcp = async <T>(name: string, args: unknown): Promise<T> => {
      const classification = classifyMcpToolSurface(name);
      assert.ok(classification, `MCP parity tool is not classified: ${name}`);
      const mcpPath =
        classification.disposition === "core"
          ? "/mcp"
          : classification.disposition === "compatibility"
            ? "/mcp/full"
            : `/mcp/packs/${classification.pack}`;
      const response = await fetch(`${baseUrl}${mcpPath}`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId++,
          method: "tools/call",
          params: {
            name,
            arguments: args
          }
        })
      });
      assert.equal(response.status, 200);
      const message = parseMcpResponse(await response.text());
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      const result = message.result as {
        isError?: boolean;
        structuredContent: T & {
          error?: { code: string; message: string };
        };
      };
      assert.equal(
        result.isError,
        undefined,
        `MCP ${name} failed: ${JSON.stringify(result.structuredContent)}`
      );
      return result.structuredContent;
    };

    const openapiResponse = await fetch(`${baseUrl}/openapi.yaml`);
    assert.equal(openapiResponse.status, 200);
    const openapiText = await openapiResponse.text();
    for (const operationId of [
      "listContinuityProjects",
      "getContinuityProject",
      "getWorkspaceContinuitySnapshot",
      "getExecutionTrajectory",
      "getWorkspaceContinuityCapsule",
      "queueContinuityAsyncJob",
      "createContinuityTask",
      "submitContinuityTaskReview",
      "completeContinuityTask",
      "getContinuityTask",
      "startContinuitySession",
      "getContinuitySession",
      "acquireContinuityLease",
      "releaseContinuityLease",
      "prepareContinuityHandoff",
      "acceptContinuityHandoff",
      "cancelContinuityHandoff",
      "forkContinuityHandoff",
      "recordContinuityEvidence"
    ]) {
      assert.match(openapiText, new RegExp(`operationId: ${operationId}`));
    }
    assert.match(
      openapiText,
      /AsyncJobQueuePayload:[\s\S]*expectedTaskRevision:[\s\S]*expectedSessionRevision:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /ContinuityTaskSubmitReviewPayload:[\s\S]*expectedRevision:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /ContinuityTaskCompletePayload:[\s\S]*expectedRevision:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /ContinuitySessionStartPayload:[\s\S]*expectedTaskRevision:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /ContinuityHandoffPreparePayload:[\s\S]*changedFiles:[\s\S]*evidenceBundleId:[\s\S]*expectedTaskRevision:/
    );

    const restProjects = await rest<{
      ok: true;
      projects: Array<{
        project: { id: string; revision: number };
        workspaces: Array<{ id: string; revision: number }>;
      }>;
    }>("GET", "/api/continuity/projects");
    const mcpProjects = await mcp<typeof restProjects>("chatcockpit.project.list", {});
    assert.deepEqual(mcpProjects, restProjects);
    assert.equal(restProjects.projects.length, 1);
    assert.doesNotMatch(JSON.stringify(restProjects), new RegExp(repoRoot));

    const project = restProjects.projects[0].project;
    const workspace = restProjects.projects[0].workspaces[0];
    const projectRest = await rest<Record<string, unknown>>(
      "GET",
      `/api/continuity/projects/${project.id}`
    );
    const projectMcp = await mcp<Record<string, unknown>>(
      "chatcockpit.project.get",
      { projectId: project.id }
    );
    assert.deepEqual(projectMcp, projectRest);
    const developmentCoordination = projectRest.developmentCoordination as {
      modelLoopOwnership?: {
        defaultOwner?: string;
        implicitCodexTurnAllowed?: boolean;
        codexTurnRequiresExplicitTransfer?: boolean;
      };
      workspaceExecution?: { mode?: string; worktreeRequiresExplicitOptIn?: boolean };
      codexContinuity?: {
        runtimeAvailability?: string;
        observation?: { status?: string; reason?: string | null; latencyBudgetMs?: number };
        nextAction?: string;
        sessionToolSequence?: string[];
        nativeTurnTool?: string | null;
      };
    };
    assert.equal(developmentCoordination.modelLoopOwnership?.defaultOwner, "caller");
    assert.equal(developmentCoordination.modelLoopOwnership?.implicitCodexTurnAllowed, false);
    assert.equal(developmentCoordination.modelLoopOwnership?.codexTurnRequiresExplicitTransfer, true);
    assert.equal(developmentCoordination.workspaceExecution?.mode, "native-checkout");
    assert.equal(developmentCoordination.workspaceExecution?.worktreeRequiresExplicitOptIn, true);
    assert.ok(["available", "unavailable", "unknown"].includes(
      developmentCoordination.codexContinuity?.runtimeAvailability ?? ""
    ));
    assert.ok(["ready", "degraded", "not-required"].includes(
      developmentCoordination.codexContinuity?.observation?.status ?? ""
    ));
    assert.equal(
      (developmentCoordination.codexContinuity?.observation?.latencyBudgetMs ?? 0) > 0,
      true
    );
    assert.ok(["start-native", "resume-native", "unavailable"].includes(
      developmentCoordination.codexContinuity?.nextAction ?? ""
    ));
    assert.ok(
      developmentCoordination.codexContinuity?.nativeTurnTool === null ||
      developmentCoordination.codexContinuity?.nativeTurnTool === "chatcockpit.codex.thread.turn.start"
    );

    const nativeRouting = projectRest.nativeDevelopment as {
      preferredLane?: string;
      nextAction?: string;
      reason?: string;
      nativeToolSequence?: string[];
    };
    assert.equal(nativeRouting.preferredLane, "chat-direct");
    assert.equal(nativeRouting.nextAction, "continue-direct");
    assert.equal(nativeRouting.reason, "CALLER_OWNS_MODEL_LOOP");
    assert.deepEqual(nativeRouting.nativeToolSequence, []);

    const taskInput = {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Continuity parity task",
      goal: "Prove REST and MCP use the same task service",
      priority: "high" as const,
      idempotencyKey: "continuity-task-0001"
    };
    const restTask = await rest<{
      ok: true;
      task: { id: string; revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/tasks", taskInput);
    assert.equal(restTask.replayed, false);
    const mcpTask = await mcp<typeof restTask>("chatcockpit.task.create", taskInput);
    assert.equal(mcpTask.replayed, true);
    assert.deepEqual(mcpTask.task, restTask.task);

    const taskRestRead = await rest<Record<string, unknown>>(
      "GET",
      `/api/continuity/tasks/${restTask.task.id}`
    );
    const taskMcpRead = await mcp<Record<string, unknown>>("chatcockpit.task.get", {
      taskId: restTask.task.id
    });
    assert.deepEqual(taskMcpRead, taskRestRead);

    const sessionInput = {
      taskId: restTask.task.id,
      title: "Chat Direct parity session",
      mode: "chat-direct" as const,
      expectedTaskRevision: restTask.task.revision,
      idempotencyKey: "continuity-session-0001"
    };
    const restSession = await rest<{
      ok: true;
      session: { id: string; revision: number };
      task: { id: string; revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/sessions/start", sessionInput);
    const mcpSession = await mcp<typeof restSession>(
      "chatcockpit.session.start",
      sessionInput
    );
    assert.equal(restSession.replayed, false);
    assert.equal(mcpSession.replayed, true);
    assert.deepEqual(mcpSession.session, restSession.session);
    assert.deepEqual(mcpSession.task, restSession.task);

    const sessionRestRead = await rest<Record<string, unknown>>(
      "GET",
      `/api/continuity/sessions/${restSession.session.id}`
    );
    const sessionMcpRead = await mcp<Record<string, unknown>>(
      "chatcockpit.session.get",
      { sessionId: restSession.session.id }
    );
    assert.deepEqual(sessionMcpRead, sessionRestRead);

    const leaseInput = {
      sessionId: restSession.session.id,
      holderId: "chat-direct-holder",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "continuity-lease-0001"
    };
    const restLease = await rest<{
      ok: true;
      lease: { id: string; revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/leases/acquire", leaseInput);
    const mcpLease = await mcp<typeof restLease>(
      "chatcockpit.lease.acquire",
      leaseInput
    );
    assert.equal(restLease.replayed, false);
    assert.equal(mcpLease.replayed, true);
    assert.deepEqual(mcpLease.lease, restLease.lease);

    const evidenceInput = {
      taskId: restTask.task.id,
      sessionId: restSession.session.id,
      kind: "typecheck" as const,
      label: "TypeScript",
      status: "passed" as const,
      required: true,
      summary: "Typecheck passed",
      expectedTaskRevision: restSession.task.revision,
      idempotencyKey: "continuity-evidence-0001"
    };
    const restEvidence = await rest<{
      ok: true;
      bundle: { id: string; revision: number };
      item: { id: string };
      task: { revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/evidence/record", evidenceInput);
    const mcpEvidence = await mcp<typeof restEvidence>(
      "chatcockpit.evidence.record",
      evidenceInput
    );
    assert.equal(restEvidence.replayed, false);
    assert.equal(mcpEvidence.replayed, true);
    assert.deepEqual(mcpEvidence.bundle, restEvidence.bundle);
    assert.deepEqual(mcpEvidence.item, restEvidence.item);

    const reviewInput = {
      taskId: restTask.task.id,
      expectedRevision: restEvidence.task.revision,
      idempotencyKey: "continuity-review-0001"
    };
    const restReview = await rest<{
      ok: true;
      task: { id: string; revision: number; status: string };
      evidenceBundle: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/continuity/tasks/submit-review", reviewInput);
    const mcpReview = await mcp<typeof restReview>(
      "chatcockpit.task.submitReview",
      reviewInput
    );
    assert.equal(restReview.replayed, false);
    assert.equal(mcpReview.replayed, true);
    assert.deepEqual(mcpReview.task, restReview.task);
    assert.deepEqual(mcpReview.evidenceBundle, restReview.evidenceBundle);
    assert.equal(restReview.task.status, "review");
    assert.equal(restReview.evidenceBundle.status, "complete");

    const handoffInput = {
      taskId: restTask.task.id,
      sessionId: restSession.session.id,
      toMode: "codex-session" as const,
      goal: "Continue the same task in Codex Session mode",
      completedItems: ["REST and MCP parity verified"],
      pendingItems: ["Bind a Codex thread"],
      changedFiles: ["src/application/project-service.ts"],
      risks: [],
      nextAction: "Bind an existing Codex thread",
      gitHead: null,
      gitBranch: "main",
      gitDirty: true,
      evidenceBundleId: restEvidence.bundle.id,
      expectedTaskRevision: restReview.task.revision,
      idempotencyKey: "continuity-handoff-0001"
    };
    const restHandoff = await rest<{
      ok: true;
      handoff: { id: string; revision: number };
      task: { revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/handoffs/prepare", handoffInput);
    const mcpHandoff = await mcp<typeof restHandoff>(
      "chatcockpit.handoff.prepare",
      handoffInput
    );
    assert.equal(restHandoff.replayed, false);
    assert.equal(mcpHandoff.replayed, true);
    assert.deepEqual(mcpHandoff.handoff, restHandoff.handoff);

    const restSnapshot = await rest<{
      ok: true;
      snapshot: {
        project: { id: string };
        workspace: { id: string };
        activeLease: { id: string; sessionId: string } | null;
        readOnly: boolean;
        readOnlyReason: string | null;
        git: {
          available: boolean;
          changedPaths: string[];
        };
        tasks: Array<{
          task: { id: string; status: string };
          sessions: Array<{ id: string; status: string }>;
          runtimes: Array<{
            sessionId: string;
            binding: {
              id: string;
              runtimeKind: string;
              externalRunId: string | null;
              status: string;
            } | null;
            job: {
              id: string;
              status: string;
              artifacts: Array<{ key: string; label: string; path: string }>;
            } | null;
          }>;
          latestHandoff: { id: string; status: string } | null;
          evidence: {
            verificationState: string;
            items: Array<{ id: string; required: boolean; status: string }>;
          } | null;
          executionPolicy: {
            policy: string;
            allowed: boolean;
            blockers: string[];
            spec: { state: string; pinnedVersion: number | null; currentVersion: number | null };
            plan: { state: string; pinnedVersion: number | null; currentVersion: number | null };
          };
          completion: {
            eligible: boolean;
            blockers: Array<{ code: string; message: string }>;
          };
        }>;
        pendingApprovals: unknown[];
      };
    }>(
      "GET",
      `/api/continuity/workspaces/${workspace.id}/snapshot`
    );
    const mcpSnapshot = await mcp<typeof restSnapshot>(
      "chatcockpit.workspace.snapshot",
      { workspaceId: workspace.id }
    );
    assert.deepEqual(mcpSnapshot, restSnapshot);
    assert.equal(restSnapshot.snapshot.project.id, project.id);
    assert.equal(restSnapshot.snapshot.workspace.id, workspace.id);
    assert.equal(restSnapshot.snapshot.activeLease?.id, restLease.lease.id);
    assert.equal(
      restSnapshot.snapshot.activeLease?.sessionId,
      restSession.session.id
    );
    assert.equal(restSnapshot.snapshot.readOnly, true);
    assert.equal(restSnapshot.snapshot.readOnlyReason, "active-writer");
    assert.equal(restSnapshot.snapshot.tasks.length, 1);
    assert.equal(restSnapshot.snapshot.tasks[0].task.id, restTask.task.id);
    assert.equal(
      restSnapshot.snapshot.tasks[0].sessions[0].id,
      restSession.session.id
    );
    assert.equal(
      restSnapshot.snapshot.tasks[0].latestHandoff?.id,
      restHandoff.handoff.id
    );
    assert.equal(
      restSnapshot.snapshot.tasks[0].evidence?.verificationState,
      "verified"
    );
    assert.equal(
      restSnapshot.snapshot.tasks[0].evidence?.items[0].required,
      true
    );
    assert.equal(
      restSnapshot.snapshot.tasks[0].executionPolicy.policy,
      "planning-optional"
    );
    assert.equal(restSnapshot.snapshot.tasks[0].executionPolicy.allowed, true);
    assert.deepEqual(restSnapshot.snapshot.tasks[0].executionPolicy.blockers, []);
    assert.equal(restSnapshot.snapshot.tasks[0].executionPolicy.spec.state, "not-bound");
    assert.equal(restSnapshot.snapshot.tasks[0].executionPolicy.plan.state, "not-bound");
    assert.equal(restSnapshot.snapshot.tasks[0].completion.eligible, false);
    assert.deepEqual(
      restSnapshot.snapshot.tasks[0].completion.blockers
        .map((blocker) => blocker.code)
        .sort(),
      [
        "ACCEPTED_HANDOFF_REQUIRED",
        "ACTIVE_WRITER_LEASE",
        "READY_HANDOFF_PENDING"
      ].sort()
    );
    assert.equal(restSnapshot.snapshot.tasks[0].runtimes.length, 1);
    assert.equal(restSnapshot.snapshot.tasks[0].runtimes[0].binding, null);
    assert.equal(restSnapshot.snapshot.tasks[0].runtimes[0].job, null);
    assert.doesNotMatch(JSON.stringify(restSnapshot), new RegExp(repoRoot));

    const restTrajectory = await rest<{
      ok: true;
      trajectory: {
        version: string;
        activity: { id: string; workspaceId: string | null; taskId: string | null };
        events: Array<{ kind: string; category: string; createdAt: string }>;
        bounded: boolean;
      };
    }>(
      "GET",
      `/api/trajectories/${restSession.session.id}?limit=20`
    );
    const mcpTrajectory = await mcp<typeof restTrajectory>(
      "chatcockpit.trajectory.read",
      { activityId: restSession.session.id, limit: 20 }
    );
    assert.deepEqual(mcpTrajectory, restTrajectory);
    assert.equal(restTrajectory.trajectory.activity.id, restSession.session.id);
    assert.equal(restTrajectory.trajectory.activity.workspaceId, workspace.id);
    assert.equal(restTrajectory.trajectory.activity.taskId, restTask.task.id);
    assert.equal(restTrajectory.trajectory.bounded, true);
    assert.doesNotMatch(JSON.stringify(restTrajectory), new RegExp(repoRoot));

    const capsuleRoute =
      `/api/continuity/workspaces/${workspace.id}/capsule` +
      `?taskId=${restTask.task.id}&activityId=${restSession.session.id}&trajectoryLimit=10`;
    const restCapsule = await rest<{
      ok: true;
      capsule: {
        version: string;
        source: { modelLoopOwner: string; sessionId: string | null; activityId: string | null };
        objective: string | null;
        verification: { state: string };
        trajectory: { activityId: string } | null;
        markdown: string;
      };
    }>("GET", capsuleRoute);
    const mcpCapsule = await mcp<typeof restCapsule>(
      "chatcockpit.continuity.capsule",
      {
        workspaceId: workspace.id,
        taskId: restTask.task.id,
        activityId: restSession.session.id,
        trajectoryLimit: 10
      }
    );
    assert.deepEqual(mcpCapsule, restCapsule);
    assert.equal(restCapsule.capsule.version, "1");
    assert.equal(restCapsule.capsule.source.modelLoopOwner, "chatgpt");
    assert.equal(restCapsule.capsule.source.sessionId, restSession.session.id);
    assert.equal(restCapsule.capsule.source.activityId, restSession.session.id);
    assert.equal(restCapsule.capsule.objective, handoffInput.goal);
    assert.equal(restCapsule.capsule.verification.state, "verified");
    assert.equal(restCapsule.capsule.trajectory?.activityId, restSession.session.id);
    assert.match(restCapsule.capsule.markdown, /ChatCockpit Continuity Capsule v1/);
    assert.doesNotMatch(JSON.stringify(restCapsule), new RegExp(repoRoot));

    const acceptInput = {
      handoffId: restHandoff.handoff.id,
      expectedRevision: restHandoff.handoff.revision,
      idempotencyKey: "continuity-accept-0001"
    };
    const restAccepted = await rest<{
      ok: true;
      handoff: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/continuity/handoffs/accept", acceptInput);
    const mcpAccepted = await mcp<typeof restAccepted>(
      "chatcockpit.handoff.accept",
      acceptInput
    );
    assert.equal(restAccepted.replayed, false);
    assert.equal(mcpAccepted.replayed, true);
    assert.deepEqual(mcpAccepted.handoff, restAccepted.handoff);
    assert.equal(restAccepted.handoff.status, "accepted");

    const releaseInput = {
      leaseId: restLease.lease.id,
      sessionId: restSession.session.id,
      holderId: "chat-direct-holder",
      expectedRevision: restLease.lease.revision,
      idempotencyKey: "continuity-release-0001"
    };
    const restReleased = await rest<{
      ok: true;
      lease: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/continuity/leases/release", releaseInput);
    const mcpReleased = await mcp<typeof restReleased>(
      "chatcockpit.lease.release",
      releaseInput
    );
    assert.equal(restReleased.replayed, false);
    assert.equal(mcpReleased.replayed, true);
    assert.deepEqual(mcpReleased.lease, restReleased.lease);
    assert.equal(restReleased.lease.status, "released");

    const completionReadySnapshot = await rest<typeof restSnapshot>(
      "GET",
      `/api/continuity/workspaces/${workspace.id}/snapshot`
    );
    assert.equal(
      completionReadySnapshot.snapshot.tasks[0].completion.eligible,
      true
    );
    assert.deepEqual(
      completionReadySnapshot.snapshot.tasks[0].completion.blockers,
      []
    );

    const completionInput = {
      taskId: restTask.task.id,
      expectedRevision: restHandoff.task.revision,
      idempotencyKey: "continuity-complete-0001"
    };
    const restCompleted = await rest<{
      ok: true;
      task: { id: string; revision: number; status: string; activeSessionId: null };
      sessions: Array<{
        id: string;
        status: string;
        activeRuntimeBindingId: string | null;
      }>;
      handoff: { id: string; status: string };
      evidenceBundle: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/continuity/tasks/complete", completionInput);
    const mcpCompleted = await mcp<typeof restCompleted>(
      "chatcockpit.task.complete",
      completionInput
    );
    assert.equal(restCompleted.replayed, false);
    assert.equal(mcpCompleted.replayed, true);
    assert.deepEqual(mcpCompleted.task, restCompleted.task);
    assert.deepEqual(mcpCompleted.sessions, restCompleted.sessions);
    assert.deepEqual(mcpCompleted.handoff, restCompleted.handoff);
    assert.deepEqual(mcpCompleted.evidenceBundle, restCompleted.evidenceBundle);
    assert.equal(restCompleted.task.status, "completed");
    assert.equal(restCompleted.task.activeSessionId, null);
    assert.equal(restCompleted.sessions[0]?.status, "completed");
    assert.equal(restCompleted.handoff.status, "accepted");
    assert.equal(restCompleted.evidenceBundle.status, "complete");

    const releasedSnapshot = await rest<typeof restSnapshot>(
      "GET",
      `/api/continuity/workspaces/${workspace.id}/snapshot`
    );
    assert.equal(releasedSnapshot.snapshot.activeLease, null);
    assert.equal(releasedSnapshot.snapshot.readOnly, false);
    assert.equal(releasedSnapshot.snapshot.readOnlyReason, null);
    assert.equal(
      releasedSnapshot.snapshot.tasks[0].latestHandoff?.status,
      "accepted"
    );
    assert.equal(releasedSnapshot.snapshot.tasks[0].task.status, "completed");
    assert.equal(
      releasedSnapshot.snapshot.tasks[0].sessions[0].status,
      "completed"
    );

    const asyncTask = await rest<typeof restTask>(
      "POST",
      "/api/continuity/tasks",
      {
        projectId: project.id,
        workspaceId: workspace.id,
        title: "Async Job parity task",
        goal: "Verify one durable Queue/Runner Job binding",
        priority: "normal",
        idempotencyKey: "continuity-task-async-0001"
      }
    );
    const asyncSession = await rest<typeof restSession>(
      "POST",
      "/api/continuity/sessions/start",
      {
        taskId: asyncTask.task.id,
        title: "Async Agent session",
        mode: "async-agent",
        expectedTaskRevision: asyncTask.task.revision,
        idempotencyKey: "continuity-session-async-0001"
      }
    );
    const asyncQueueInput = {
      taskId: asyncTask.task.id,
      sessionId: asyncSession.session.id,
      expectedTaskRevision: asyncSession.task.revision,
      expectedSessionRevision: asyncSession.session.revision,
      repoId: workspace.repoId,
      title: "Continuity-bound async execution",
      instructions: "Inspect the fixture and produce a public-safe summary.",
      executionMode: "develop",
      worktreePolicy: "auto",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      commitPolicy: "propose",
      idempotencyKey: "continuity-async-queue-0001"
    };
    const restAsyncQueue = await rest<{
      ok: true;
      task: { id: string; revision: number };
      session: { id: string; revision: number; activeRuntimeBindingId: string };
      binding: {
        id: string;
        runtimeKind: string;
        externalRunId: string;
        relation: string;
      };
      job: {
        id: string;
        status: string;
        payload: {
          repoId: string;
          title: string;
          continuityTaskId: string;
          continuitySessionId: string;
          continuityRuntimeBindingId: string;
        };
      };
      replayed: boolean;
    }>("POST", "/api/continuity/async-jobs/queue", asyncQueueInput);
    const mcpAsyncQueue = await mcp<typeof restAsyncQueue>(
      "chatcockpit.asyncJob.queue",
      asyncQueueInput
    );
    assert.equal(restAsyncQueue.replayed, false);
    assert.equal(mcpAsyncQueue.replayed, true);
    assert.deepEqual(mcpAsyncQueue.task, restAsyncQueue.task);
    assert.deepEqual(mcpAsyncQueue.session, restAsyncQueue.session);
    assert.deepEqual(mcpAsyncQueue.binding, restAsyncQueue.binding);
    assert.deepEqual(mcpAsyncQueue.job, restAsyncQueue.job);
    assert.equal(restAsyncQueue.binding.runtimeKind, "async-runner");
    assert.equal(restAsyncQueue.binding.externalRunId, restAsyncQueue.job.id);
    assert.equal(restAsyncQueue.binding.relation, "queued");
    assert.equal(
      restAsyncQueue.session.activeRuntimeBindingId,
      restAsyncQueue.binding.id
    );
    assert.equal(
      restAsyncQueue.job.payload.continuityRuntimeBindingId,
      restAsyncQueue.binding.id
    );
    assert.doesNotMatch(JSON.stringify(restAsyncQueue), /Inspect the fixture/);

    const asyncSnapshot = await rest<typeof restSnapshot>(
      "GET",
      `/api/continuity/workspaces/${workspace.id}/snapshot`
    );
    const asyncProjection = asyncSnapshot.snapshot.tasks.find(
      ({ task }) => task.id === asyncTask.task.id
    );
    const asyncRuntime = asyncProjection?.runtimes.find(
      ({ sessionId }) => sessionId === asyncSession.session.id
    );
    assert.equal(asyncRuntime?.binding?.id, restAsyncQueue.binding.id);
    assert.equal(asyncRuntime?.binding?.runtimeKind, "async-runner");
    assert.equal(asyncRuntime?.binding?.externalRunId, restAsyncQueue.job.id);
    assert.equal(asyncRuntime?.job?.id, restAsyncQueue.job.id);
    assert.equal(asyncRuntime?.job?.status, "queued");
    assert.deepEqual(asyncRuntime?.job?.artifacts, []);
    assert.equal(asyncProjection?.completion.eligible, false);
    assert.ok(
      asyncProjection?.completion.blockers.some(
        (blocker) => blocker.code === "TASK_STATUS_NOT_REVIEW"
      )
    );
    assert.doesNotMatch(JSON.stringify(asyncSnapshot), /Inspect the fixture/);
    assert.doesNotMatch(JSON.stringify(asyncSnapshot), new RegExp(repoRoot));

    const cancelTask = await rest<typeof restTask>(
      "POST",
      "/api/continuity/tasks",
      {
        projectId: project.id,
        workspaceId: workspace.id,
        title: "Cancel handoff parity task",
        goal: "Verify a ready handoff can be explicitly cancelled",
        priority: "normal",
        idempotencyKey: "continuity-task-cancel-0001"
      }
    );
    const cancelSession = await rest<typeof restSession>(
      "POST",
      "/api/continuity/sessions/start",
      {
        taskId: cancelTask.task.id,
        title: "Cancel handoff source session",
        mode: "chat-direct",
        expectedTaskRevision: cancelTask.task.revision,
        idempotencyKey: "continuity-session-cancel-0001"
      }
    );
    const cancelHandoff = await rest<typeof restHandoff>(
      "POST",
      "/api/continuity/handoffs/prepare",
      {
        taskId: cancelTask.task.id,
        sessionId: cancelSession.session.id,
        toMode: "async-agent",
        goal: "Cancel this checkpoint instead of transferring it",
        completedItems: ["Checkpoint prepared"],
        pendingItems: ["Decision pending"],
        changedFiles: [],
        risks: [],
        nextAction: "Choose cancel",
        gitHead: null,
        gitBranch: "main",
        gitDirty: false,
        expectedTaskRevision: cancelSession.task.revision,
        idempotencyKey: "continuity-handoff-cancel-prepare-0001"
      }
    );
    const cancelInput = {
      handoffId: cancelHandoff.handoff.id,
      expectedRevision: cancelHandoff.handoff.revision,
      idempotencyKey: "continuity-handoff-cancel-0001"
    };
    const restCancelled = await rest<typeof restAccepted>(
      "POST",
      "/api/continuity/handoffs/cancel",
      cancelInput
    );
    const mcpCancelled = await mcp<typeof restCancelled>(
      "chatcockpit.handoff.cancel",
      cancelInput
    );
    assert.equal(restCancelled.replayed, false);
    assert.equal(mcpCancelled.replayed, true);
    assert.deepEqual(mcpCancelled.handoff, restCancelled.handoff);
    assert.equal(restCancelled.handoff.status, "superseded");

    const forkTask = await rest<typeof restTask>(
      "POST",
      "/api/continuity/tasks",
      {
        projectId: project.id,
        workspaceId: workspace.id,
        title: "Fork handoff parity task",
        goal: "Verify a ready handoff can create a child execution line",
        priority: "high",
        idempotencyKey: "continuity-task-fork-0001"
      }
    );
    const forkSourceSession = await rest<typeof restSession>(
      "POST",
      "/api/continuity/sessions/start",
      {
        taskId: forkTask.task.id,
        title: "Fork handoff source session",
        mode: "chat-direct",
        expectedTaskRevision: forkTask.task.revision,
        idempotencyKey: "continuity-session-fork-source-0001"
      }
    );
    const forkHandoff = await rest<typeof restHandoff>(
      "POST",
      "/api/continuity/handoffs/prepare",
      {
        taskId: forkTask.task.id,
        sessionId: forkSourceSession.session.id,
        toMode: "codex-session",
        goal: "Continue independently in a child Codex task",
        completedItems: ["Source checkpoint prepared"],
        pendingItems: ["Start child session"],
        changedFiles: ["README.md"],
        risks: ["Child task may diverge from source"],
        nextAction: "Create a child task and Codex session",
        gitHead: null,
        gitBranch: "main",
        gitDirty: true,
        expectedTaskRevision: forkSourceSession.task.revision,
        idempotencyKey: "continuity-handoff-fork-prepare-0001"
      }
    );
    const forkInput = {
      handoffId: forkHandoff.handoff.id,
      expectedRevision: forkHandoff.handoff.revision,
      title: "Forked child task",
      sessionTitle: "Forked Codex session",
      idempotencyKey: "continuity-handoff-fork-0001"
    };
    const restForked = await rest<{
      ok: true;
      handoff: { id: string; status: string };
      task: {
        id: string;
        parentTaskId: string | null;
        activeSessionId: string | null;
      };
      session: {
        id: string;
        taskId: string;
        mode: string;
      };
      replayed: boolean;
    }>("POST", "/api/continuity/handoffs/fork", forkInput);
    const mcpForked = await mcp<typeof restForked>(
      "chatcockpit.handoff.fork",
      forkInput
    );
    assert.equal(restForked.replayed, false);
    assert.equal(mcpForked.replayed, true);
    assert.deepEqual(mcpForked.handoff, restForked.handoff);
    assert.deepEqual(mcpForked.task, restForked.task);
    assert.deepEqual(mcpForked.session, restForked.session);
    assert.equal(restForked.handoff.status, "accepted");
    assert.equal(restForked.task.parentTaskId, forkTask.task.id);
    assert.equal(restForked.task.activeSessionId, restForked.session.id);
    assert.equal(restForked.session.taskId, restForked.task.id);
    assert.equal(restForked.session.mode, "codex-session");

    const decisionSnapshot = await rest<typeof restSnapshot>(
      "GET",
      `/api/continuity/workspaces/${workspace.id}/snapshot`
    );
    const cancelledProjection = decisionSnapshot.snapshot.tasks.find(
      ({ task }) => task.id === cancelTask.task.id
    );
    const forkSourceProjection = decisionSnapshot.snapshot.tasks.find(
      ({ task }) => task.id === forkTask.task.id
    );
    assert.equal(cancelledProjection?.latestHandoff?.status, "superseded");
    assert.equal(forkSourceProjection?.latestHandoff?.status, "accepted");
    assert.ok(
      decisionSnapshot.snapshot.tasks.some(
        ({ task }) => task.id === restForked.task.id
      )
    );
  } finally {
    await testServer?.close();
    if (originalConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
    }
    if (originalToken === undefined) {
      delete process.env.CHATCOCKPIT_API_TOKEN;
    } else {
      process.env.CHATCOCKPIT_API_TOKEN = originalToken;
    }
    if (originalExposed === undefined) {
      delete process.env.CHATCOCKPIT_EXPOSED;
    } else {
      process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    }
  }
}

await runContinuityApiVerification();
process.stdout.write("VERIFY_CONTINUITY_API_OK\n");
