import type { ContinuityServices } from "../../application/continuity-services.js";
import { asyncJobQueueSchema } from "../../contracts/async-job.js";
import {
  evidenceRecordSchema,
  handoffAcceptSchema,
  handoffCancelSchema,
  handoffForkSchema,
  handoffPrepareSchema,
  leaseAcquireSchema,
  leaseReleaseSchema,
  projectGetSchema,
  projectListSchema,
  sessionGetSchema,
  sessionStartSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskSubmitReviewSchema,
  taskGetSchema,
  workspaceSnapshotSchema
} from "../../contracts/continuity.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const idempotentMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const leaseAcquireAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

export function buildContinuityMcpTools(
  services: ContinuityServices
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.asyncJob.queue",
      title: "Queue continuity-bound async job",
      description:
        "Queue one file-backed Codex Runner job for an active async-agent Session and bind the Job ID to durable TokenPilot Task/Session identity. Same-key replay never creates a second Job file.",
      inputSchema: asyncJobQueueSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.asyncJobs.queue(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.project.list",
      title: "List TokenPilot projects",
      description:
        "List configured TokenPilot projects and their public-safe workspace projections without exposing local absolute paths.",
      inputSchema: projectListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        projects: services.projects.list(context, input.status)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.project.get",
      title: "Read TokenPilot project",
      description:
        "Read one TokenPilot project and its public-safe workspaces by TokenPilot project id.",
      inputSchema: projectGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.projects.get(context, input.projectId)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.workspace.snapshot",
      title: "Read workspace continuity snapshot",
      description:
        "Read public-safe Git, active writer, task, session, handoff, evidence, and pending approval state for one TokenPilot workspace.",
      inputSchema: workspaceSnapshotSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        snapshot: services.workspaces.snapshot(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.task.create",
      title: "Create continuity task",
      description:
        "Create an idempotent TokenPilot development task bound to an existing project and workspace.",
      inputSchema: taskCreateSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.tasks.create(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.task.submitReview",
      title: "Submit continuity task for review",
      description:
        "Finalize passed required evidence and move an in-progress or blocked task into review through one idempotent domain transition.",
      inputSchema: taskSubmitReviewSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.taskCompletion.submitReview(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.task.complete",
      title: "Complete continuity task",
      description:
        "Complete a review task only when its accepted handoff, required evidence, writer, runtime run, and approval state satisfy TokenPilot completion policy.",
      inputSchema: taskCompleteSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.taskCompletion.complete(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.task.get",
      title: "Read continuity task",
      description: "Read one TokenPilot development task by task id.",
      inputSchema: taskGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        task: services.tasks.get(context, input.taskId)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.session.start",
      title: "Start development session",
      description:
        "Start an idempotent Chat Direct, Codex Session, or Async Agent development session and bind it to a task revision.",
      inputSchema: sessionStartSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.sessions.start(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.session.get",
      title: "Read development session",
      description: "Read one durable TokenPilot development session by session id.",
      inputSchema: sessionGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        session: services.sessions.get(context, input.sessionId)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.lease.acquire",
      title: "Acquire workspace writer lease",
      description:
        "Acquire the single active writer lease for a session workspace. This can block other runtimes from mutating the workspace.",
      inputSchema: leaseAcquireSchema,
      annotations: leaseAcquireAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.leases.acquire(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.lease.release",
      title: "Release workspace writer lease",
      description:
        "Release an active workspace writer lease using lease identity, holder identity, revision, and idempotency control.",
      inputSchema: leaseReleaseSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.leases.release(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.handoff.prepare",
      title: "Prepare development handoff",
      description:
        "Create a ready handoff checkpoint with task state, changed files, risks, Git state, evidence reference, and next action.",
      inputSchema: handoffPrepareSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.handoffs.prepare(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.handoff.cancel",
      title: "Cancel development handoff",
      description:
        "Supersede a ready handoff checkpoint using optimistic revision and idempotency controls.",
      inputSchema: handoffCancelSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.handoffs.cancel(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.handoff.fork",
      title: "Fork development handoff",
      description:
        "Consume a ready handoff by creating a child task and a target-mode development session in one idempotent transaction.",
      inputSchema: handoffForkSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.handoffs.fork(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.handoff.accept",
      title: "Accept development handoff",
      description:
        "Accept a ready handoff checkpoint using optimistic revision and idempotency controls.",
      inputSchema: handoffAcceptSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.handoffs.accept(context, input)
      })
    }),
    defineMcpTool({
      name: "tokenpilot.evidence.record",
      title: "Record verification evidence",
      description:
        "Record structured test, build, lint, review, diff, screenshot, or manual evidence for a task session.",
      inputSchema: evidenceRecordSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.evidence.record(context, input)
      })
    })
  ];
}
