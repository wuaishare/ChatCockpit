import { z } from "zod";

import type { RuntimeApprovalService } from "../../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../../application/runtime-event-service.js";
import type { RuntimeService } from "../../application/runtime-service.js";
import type { RuntimeTurnService } from "../../application/runtime-turn-service.js";
import {
  codexApprovalRespondSchema,
  codexRuntimeEventsQuerySchema,
  codexSessionBindSchema,
  codexSessionForkSchema,
  codexSessionResumeSchema,
  codexThreadListSchema,
  codexThreadReadSchema,
  codexTurnInterruptSchema,
  codexTurnStartSchema
} from "../../contracts/codex-runtime.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const emptyInputSchema = z.object({});
const runtimeMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;
const runtimeExecutionAnnotations = {
  ...runtimeMutationAnnotations,
  destructiveHint: true
} as const;

export function buildRuntimeMcpTools(
  runtimeService: RuntimeService,
  runtimeBindingService: RuntimeBindingService,
  runtimeTurnService: RuntimeTurnService,
  runtimeApprovalService: RuntimeApprovalService,
  runtimeEventService: RuntimeEventService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.runtime.capabilities",
      title: "Read coding runtime capabilities",
      description:
        "Read the public-safe Codex App Server availability, version source, protocol family, and stable method snapshot without exposing local binary paths.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context) => ({
        ok: true,
        capabilities: await runtimeService.capabilities(context)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.list",
      title: "List Codex threads",
      description:
        "List public-safe Codex thread metadata with optional ChatCockpit workspace, search, archive, cursor, and limit filters. Raw cwd and instruction paths are omitted.",
      inputSchema: codexThreadListSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeService.listCodexThreads(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.read",
      title: "Read Codex thread metadata",
      description:
        "Read one public-safe Codex thread metadata projection. Turn history is intentionally unavailable until a reviewed public-safe projection exists.",
      inputSchema: codexThreadReadSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => ({
        ok: true,
        thread: await runtimeService.readCodexThread(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.session.bind",
      title: "Bind Codex thread to session",
      description:
        "Bind an existing Codex thread to a ChatCockpit codex-session after validating session revision and workspace identity. This does not start a Codex turn.",
      inputSchema: codexSessionBindSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeBindingService.bind(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.session.resume",
      title: "Resume and bind Codex thread",
      description:
        "Resume an existing Codex App Server thread and bind it to a ChatCockpit codex-session using two-phase idempotency. This does not start a Codex turn.",
      inputSchema: codexSessionResumeSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeBindingService.resume(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.session.fork",
      title: "Fork and bind Codex thread",
      description:
        "Fork a Codex thread into a new durable thread and bind the fork to a ChatCockpit codex-session using two-phase idempotency. This does not start a Codex turn.",
      inputSchema: codexSessionForkSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeBindingService.fork(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.turn.start",
      title: "Start explicit Codex turn",
      description:
        "Start one explicit Codex model loop only after validating Runtime Binding, Writer Lease, Git checkpoint, Evidence Bundle, Session revision, and Task revision. The operation fixes approval routing to on-request user review and does not allow cwd, model, sandbox, or instruction overrides.",
      inputSchema: codexTurnStartSchema,
      annotations: runtimeExecutionAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeTurnService.start(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.turn.interrupt",
      title: "Interrupt Codex turn",
      description:
        "Interrupt one active Codex turn, close its writer lease, move the session to handoff-ready, and record a lifecycle event using an idempotent explicit operation.",
      inputSchema: codexTurnInterruptSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeTurnService.interrupt(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.approval.respond",
      title: "Respond to Codex approval",
      description:
        "Respond explicitly to a pending command or file-change approval with accept, decline, or cancel. Session-wide approval and permission escalation are intentionally unavailable.",
      inputSchema: codexApprovalRespondSchema,
      annotations: runtimeExecutionAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await runtimeApprovalService.respond(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.events.read",
      title: "Read Codex runtime events",
      description:
        "Read append-only public-safe lifecycle, approval, item, warning, and error events for one ChatCockpit Session or Runtime Run. Command output, cwd, file patches, raw prompts, and private request payloads are omitted.",
      inputSchema: codexRuntimeEventsQuerySchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...runtimeEventService.read(context, input)
      })
    })
  ];
}
