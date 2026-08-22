import { z } from "zod";

import type { CodexNativeSessionService } from "../../application/codex-native-session-service.js";
import type { CodexNativeTurnService } from "../../application/codex-native-turn-service.js";
import type { RuntimeApprovalService } from "../../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../../application/runtime-event-service.js";
import type { RuntimeService } from "../../application/runtime-service.js";
import type { RuntimeTurnService } from "../../application/runtime-turn-service.js";
import {
  codexApprovalRespondSchema,
  codexNativeApprovalListSchema,
  codexNativeEventsQuerySchema,
  codexNativeThreadForkSchema,
  codexNativeThreadResumeSchema,
  codexNativeThreadStartSchema,
  codexNativeTurnInterruptSchema,
  codexNativeTurnStartSchema,
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
  codexNativeSessionService: CodexNativeSessionService,
  codexNativeTurnService: CodexNativeTurnService,
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
      name: "chatcockpit.codex.account.status",
      title: "Read Codex account and quota status",
      description:
        "Read a public-safe Codex account and rate-limit projection for routing decisions. Email, credentials, credit balances, reset-credit identifiers, and raw provider payloads are omitted.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context) => ({
        ok: true,
        account: await codexNativeSessionService.accountStatus(context)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.start",
      title: "Start native Codex thread",
      description:
        "Create a new provider-native Codex thread for one registered ChatCockpit workspace. Only the private workspace cwd is supplied to App Server; model, sandbox, approval policy, instructions, and other native settings inherit the user's Codex configuration.",
      inputSchema: codexNativeThreadStartSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await codexNativeSessionService.start(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.resume",
      title: "Resume native Codex thread",
      description:
        "Resume the same authoritative Codex thread after verifying its registered Workspace. This preserves the native Thread ID and does not create a ChatCockpit Task, development Session, or Handoff.",
      inputSchema: codexNativeThreadResumeSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await codexNativeSessionService.resume(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.fork",
      title: "Fork native Codex thread",
      description:
        "Create a provider-native Codex fork after verifying the source Thread belongs to the selected Workspace. ChatCockpit preserves Codex lineage instead of manufacturing its own same-provider fork model.",
      inputSchema: codexNativeThreadForkSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await codexNativeSessionService.fork(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.turn.start",
      title: "Start native Codex turn",
      description:
        "Start a provider-native Codex turn on an existing registered Thread without creating a ChatCockpit Task, development Session, Handoff, Spec, Plan, or Writer Lease. Codex keeps the authoritative model loop and native configuration.",
      inputSchema: codexNativeTurnStartSchema,
      annotations: runtimeExecutionAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await codexNativeTurnService.start(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.turn.interrupt",
      title: "Interrupt native Codex turn",
      description:
        "Interrupt one provider-native Codex turn by Thread and Turn identity without requiring a ChatCockpit development Session.",
      inputSchema: codexNativeTurnInterruptSchema,
      annotations: runtimeMutationAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...(await codexNativeTurnService.interrupt(context, input))
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.approvals.list",
      title: "List native Codex approvals",
      description:
        "List bounded public-safe pending/resolved approvals observed for provider-native Codex turns. Approval decisions remain a local Operator action and are not granted to Remote MCP agents.",
      inputSchema: codexNativeApprovalListSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => ({
        ok: true,
        approvals: codexNativeTurnService.listApprovals(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.codex.thread.events.read",
      title: "Read native Codex thread activity",
      description:
        "Read a bounded public-safe event stream for provider-native Codex turns. Raw command output, cwd, patches, prompts, hidden reasoning, and provider-private payloads are omitted.",
      inputSchema: codexNativeEventsQuerySchema,
      annotations: readOnlyToolAnnotations,
      handler: async (context, input) => ({
        ok: true,
        ...codexNativeTurnService.readEvents(context, input)
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
