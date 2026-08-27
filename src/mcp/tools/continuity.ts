import type { ContinuityServices } from "../../application/continuity-services.js";
import type { CodexThreadImportService } from "../../application/codex-thread-import-service.js";
import type { ProjectDevelopmentRoutingService } from "../../application/project-development-routing-service.js";
import type { TrajectoryService } from "../../application/trajectory-service.js";
import type { ContinuityCapsuleService } from "../../application/continuity-capsule-service.js";
import { asyncJobQueueSchema } from "../../contracts/async-job.js";
import {
  continuityCapsuleSchema,
  continuityCapsuleToolOutputSchema,
  trajectoryReadSchema,
  trajectoryToolOutputSchema
} from "../../contracts/continuity-observability.js";
import {
  projectGetToolOutputSchema,
  projectListToolOutputSchema
} from "../../contracts/mcp-core-outputs.js";
import { codexThreadImportContextSchema } from "../../contracts/codex-thread-import.js";
import {
  developmentDocumentAppendVersionSchema,
  developmentDocumentCreateSchema,
  developmentDocumentGetSchema,
  developmentDocumentListSchema,
  developmentDocumentStatusSchema,
  developmentDocumentVersionGetSchema,
  taskDocumentBindSchema
} from "../../contracts/development-documents.js";
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
  services: ContinuityServices,
  codexThreadImports?: CodexThreadImportService,
  projectDevelopmentRouting?: ProjectDevelopmentRoutingService,
  trajectoryService?: TrajectoryService,
  continuityCapsules?: ContinuityCapsuleService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.asyncJob.queue",
      title: "Queue continuity-bound async job",
      description:
        "Queue one file-backed Codex Runner job for an active async-agent Session and bind the Job ID to durable ChatCockpit Task/Session identity. Same-key replay never creates a second Job file.",
      inputSchema: asyncJobQueueSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.asyncJobs.queue(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.list",
      title: "List Spec and Plan documents",
      description:
        "List public-safe Spec or Plan summaries for one ChatCockpit workspace, including lifecycle status, current version, and content hash.",
      inputSchema: developmentDocumentListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        documents: services.developmentDocuments.list(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.get",
      title: "Read Spec or Plan document",
      description:
        "Read one durable Spec or Plan with its current public-safe Markdown projection and append-only version history.",
      inputSchema: developmentDocumentGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.developmentDocuments.get(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.version.get",
      title: "Read Spec or Plan version",
      description:
        "Read one immutable public-safe Markdown version by document id and version number.",
      inputSchema: developmentDocumentVersionGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        version: services.developmentDocuments.getVersion(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.create",
      title: "Create Spec or Plan document",
      description:
        "Create one idempotent draft Spec or Plan and its immutable version 1 in a ChatCockpit project workspace.",
      inputSchema: developmentDocumentCreateSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.developmentDocuments.create(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.appendVersion",
      title: "Append Spec or Plan version",
      description:
        "Append an immutable Markdown version using optimistic revision and idempotency controls. Revised ready or approved documents return to draft.",
      inputSchema: developmentDocumentAppendVersionSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.developmentDocuments.appendVersion(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.document.updateStatus",
      title: "Update Spec or Plan status",
      description:
        "Move a Spec or Plan through its reviewed lifecycle using optimistic revision and idempotency controls.",
      inputSchema: developmentDocumentStatusSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.developmentDocuments.updateStatus(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.task.bindDocuments",
      title: "Bind Task Spec and Plan",
      description:
        "Bind or replace a Task's Spec and Plan using current immutable version pins after validating kind, project, workspace, lifecycle status, and Task revision.",
      inputSchema: taskDocumentBindSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.developmentDocuments.bindTaskDocuments(context, input)
      })
    }),
    ...(codexThreadImports
      ? [
          defineMcpTool({
            name: "chatcockpit.continuity.importedContext.read",
            title: "Read imported Codex handoff context",
            description:
              "Read one bounded public-safe page of visible user/assistant history for a Codex thread that was explicitly imported into ChatCockpit. Accepts only a durable import id, never an arbitrary local Codex thread id.",
            inputSchema: codexThreadImportContextSchema,
            annotations: readOnlyToolAnnotations,
            handler: async (context, input) => ({
              ok: true,
              import: codexThreadImports.get(context, input.importId),
              context: await codexThreadImports.readContext(context, input)
            })
          })
        ]
      : []),
    defineMcpTool({
      name: "chatcockpit.project.list",
      title: "List ChatCockpit projects",
      description:
        "List configured ChatCockpit projects and their public-safe workspace projections without exposing local absolute paths.",
      inputSchema: projectListSchema,
      outputSchema: projectListToolOutputSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        projects: services.projects.list(context, input.status)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.project.get",
      title: "Read ChatCockpit project",
      description:
        "Read one ChatCockpit project, its public-safe workspaces, model-loop ownership rules, Codex continuity metadata, and provider-native effective MCP applicability for the selected Workspace. For ChatGPT-driven project development, the caller keeps the model loop by default; a Codex native turn requires an explicit transfer/delegation decision.",
      inputSchema: projectGetSchema,
      outputSchema: projectGetToolOutputSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => {
        const project = services.projects.get(context, input.projectId);
        if (!projectDevelopmentRouting) {
          return { ok: true, ...project };
        }
        const developmentCoordination = await projectDevelopmentRouting.coordinate(
          context,
          input.projectId
        );
        return {
          ok: true,
          ...project,
          developmentCoordination,
          nativeDevelopment:
            projectDevelopmentRouting.toLegacyAssessment(developmentCoordination)
        };
      }
    }),
    ...(trajectoryService
      ? [
          defineMcpTool({
            name: "chatcockpit.trajectory.read",
            title: "Read bounded execution trajectory",
            description:
              "Read the bounded, normalized execution trajectory for one existing Operational Activity. Returns lifecycle, step, approval, control, warning/error, and device-operation events without raw commands, private paths, provider payloads, or secrets.",
            inputSchema: trajectoryReadSchema,
            outputSchema: trajectoryToolOutputSchema,
            annotations: readOnlyToolAnnotations,
            handler: (_context, input) => ({
              ok: true,
              trajectory: trajectoryService.read(input)
            })
          })
        ]
      : []),
    ...(continuityCapsules
      ? [
          defineMcpTool({
            name: "chatcockpit.continuity.capsule",
            title: "Generate continuity capsule",
            description:
              "Generate a bounded public-safe Continuity Capsule from current Project/Workspace Git state. Task/Session/Handoff/Evidence context is included only when taskId is explicitly supplied; activityId is independently optional. The capsule is regenerated from authoritative state and never guesses an unrelated Task or claims cross-runtime work became native provider history.",
            inputSchema: continuityCapsuleSchema,
            outputSchema: continuityCapsuleToolOutputSchema,
            annotations: readOnlyToolAnnotations,
            handler: (context, input) => ({
              ok: true,
              capsule: continuityCapsules.generate(context, input)
            })
          })
        ]
      : []),
    defineMcpTool({
      name: "chatcockpit.workspace.snapshot",
      title: "Read workspace continuity snapshot",
      description:
        "Read public-safe Git, active writer, task, session, handoff, evidence, and pending approval state for one ChatCockpit workspace.",
      inputSchema: workspaceSnapshotSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        snapshot: services.workspaces.snapshot(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.task.create",
      title: "Create continuity task",
      description:
        "Create an idempotent ChatCockpit development task bound to an existing project and workspace.",
      inputSchema: taskCreateSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.tasks.create(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.task.submitReview",
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
      name: "chatcockpit.task.complete",
      title: "Complete continuity task",
      description:
        "Complete a review task only when its accepted handoff, required evidence, writer, runtime run, and approval state satisfy ChatCockpit completion policy.",
      inputSchema: taskCompleteSchema,
      annotations: idempotentMutationAnnotations,
      handler: (context, input) => ({
        ok: true,
        ...services.taskCompletion.complete(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.task.get",
      title: "Read continuity task",
      description: "Read one ChatCockpit development task by task id.",
      inputSchema: taskGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        task: services.tasks.get(context, input.taskId)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.session.start",
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
      name: "chatcockpit.session.get",
      title: "Read development session",
      description: "Read one durable ChatCockpit development session by session id.",
      inputSchema: sessionGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => ({
        ok: true,
        session: services.sessions.get(context, input.sessionId)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.lease.acquire",
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
      name: "chatcockpit.lease.release",
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
      name: "chatcockpit.handoff.prepare",
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
      name: "chatcockpit.handoff.cancel",
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
      name: "chatcockpit.handoff.fork",
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
      name: "chatcockpit.handoff.accept",
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
      name: "chatcockpit.evidence.record",
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
