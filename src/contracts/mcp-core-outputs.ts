import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const nullableIdentifierSchema = identifierSchema.nullable();

export const chatDirectExecutionSchema = z.object({
  lane: z.literal("chat-direct"),
  modelLoopOwner: z.literal("chatgpt"),
  executionScope: z.enum(["workspace", "host"]),
  executor: z.string().min(1).max(200),
  selectionMode: z.enum(["automatic", "explicit"]),
  operationId: identifierSchema,
  changedPaths: z.array(z.string().max(1024)),
  evidenceBundleId: nullableIdentifierSchema,
  fallbackReason: z.string().max(240).optional(),
  compatibilityMode: z.string().max(120).optional()
});

const textPreviewSchema = z.object({
  path: z.string().max(1024),
  content: z.string(),
  truncated: z.boolean(),
  size: z.number().int().nonnegative(),
  encoding: z.string(),
  returnedBytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive(),
  previewMode: z.literal("head"),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  eof: z.boolean()
});
const directBaseSchema = z.object({
  ok: z.boolean(),
  repoId: z.string().min(1),
  execution: chatDirectExecutionSchema
});

export const fileReadToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  file: textPreviewSchema
});

export const fileReadBatchToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  files: z.array(textPreviewSchema).max(10)
});

export const fileListToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  path: z.string().max(1024),
  entries: z.array(z.object({
    name: z.string().max(1024),
    type: z.enum(["file", "directory"]),
    size: z.number().int().nonnegative().optional()
  }))
});

export const searchToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  pattern: z.string(),
  matches: z.array(z.object({
    path: z.string().max(1024),
    line: z.number().int().positive(),
    content: z.string()
  })),
  truncated: z.boolean(),
  totalMatches: z.number().int().nonnegative()
});
const mutationEnvelopeSchema = z.object({
  changedPaths: z.array(z.string().max(1024)),
  evidenceHints: z.array(z.string().max(200)),
  idempotency: z.object({
    key: z.string().min(8).max(128),
    replayed: z.boolean()
  })
});

export const fileWriteToolOutputSchema = directBaseSchema
  .extend({
    ok: z.literal(true),
    path: z.string().max(1024),
    written: z.literal(true),
    size: z.number().int().nonnegative()
  })
  .merge(mutationEnvelopeSchema);

export const fileEditToolOutputSchema = directBaseSchema
  .extend({
    ok: z.literal(true),
    path: z.string().max(1024),
    applied: z.literal(true)
  })
  .merge(mutationEnvelopeSchema);

export const shellRunToolOutputSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  executedCommand: z.string(),
  execution: chatDirectExecutionSchema
}).merge(mutationEnvelopeSchema);

const workspaceProcessStateSchema = z.enum([
  "running",
  "completed",
  "failed",
  "terminated"
]);

const idempotencyEnvelopeSchema = z.object({
  idempotency: z.object({
    key: z.string().min(8).max(128),
    replayed: z.boolean()
  })
});

export const workspaceExecToolOutputSchema = z.object({
  ok: z.literal(true),
  repoId: z.string().min(1),
  processId: identifierSchema,
  state: z.literal("running"),
  execution: chatDirectExecutionSchema
}).merge(idempotencyEnvelopeSchema);

export const workspaceProcessReadToolOutputSchema = z.object({
  ok: z.literal(true),
  repoId: z.string().min(1),
  processId: identifierSchema,
  state: workspaceProcessStateSchema,
  exitCode: z.number().int().nullable(),
  errorCode: z.string().max(200).nullable(),
  chunks: z.array(z.object({
    sequence: z.number().int().nonnegative(),
    stream: z.enum(["stdout", "stderr"]),
    content: z.string(),
    capReached: z.boolean()
  })).max(200),
  nextCursor: z.number().int().nonnegative(),
  execution: chatDirectExecutionSchema
});

export const workspaceProcessControlToolOutputSchema = z.discriminatedUnion("action", [
  z.object({
    ok: z.literal(true),
    repoId: z.string().min(1),
    processId: identifierSchema,
    action: z.literal("input"),
    accepted: z.literal(true),
    execution: chatDirectExecutionSchema
  }).merge(idempotencyEnvelopeSchema),
  z.object({
    ok: z.literal(true),
    repoId: z.string().min(1),
    processId: identifierSchema,
    action: z.literal("terminate"),
    terminationRequested: z.literal(true),
    execution: chatDirectExecutionSchema
  }).merge(idempotencyEnvelopeSchema)
]);
export const gitStatusToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  branch: z.string(),
  entries: z.array(z.object({
    path: z.string().max(1024),
    status: z.string().max(80),
    staged: z.boolean()
  }))
});

export const gitDiffToolOutputSchema = directBaseSchema.extend({
  ok: z.literal(true),
  diff: z.string(),
  truncated: z.boolean()
});

export const gitStageToolOutputSchema = z.object({
  ok: z.boolean(),
  repoId: z.string().min(1),
  staged: z.boolean(),
  paths: z.array(z.string().max(1024)).max(200),
  error: z.string().optional(),
  execution: chatDirectExecutionSchema
}).merge(mutationEnvelopeSchema);

export const gitSyncToolOutputSchema = z.object({
  ok: z.boolean(),
  repoId: z.string().min(1),
  action: z.enum(["fetch", "fast-forward", "worktree-prune"]),
  branch: z.string().nullable(),
  upstreamRemote: z.string().nullable(),
  headBefore: z.string(),
  headAfter: z.string(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  changed: z.boolean(),
  paths: z.array(z.string().max(1024)).max(500),
  state: z.enum(["fetched", "fast-forwarded", "up-to-date", "ahead", "worktree-pruned"]),
  error: z.string().optional(),
  execution: chatDirectExecutionSchema
}).merge(mutationEnvelopeSchema);

export const gitPushToolOutputSchema = z.object({
  ok: z.boolean(),
  repoId: z.string().min(1),
  branch: z.string(),
  upstreamRemote: z.string(),
  head: z.string(),
  upstreamBefore: z.string(),
  aheadBefore: z.number().int().nonnegative(),
  behindBefore: z.number().int().nonnegative(),
  pushed: z.boolean(),
  paths: z.array(z.string().max(1024)).max(500),
  pathCount: z.number().int().nonnegative(),
  pathsTruncated: z.boolean(),
  state: z.enum(["pushed", "up-to-date"]),
  error: z.string().optional(),
  execution: chatDirectExecutionSchema
}).merge(mutationEnvelopeSchema);

export const gitCommitToolOutputSchema = z.object({
  ok: z.boolean(),
  repoId: z.string().min(1),
  committed: z.boolean(),
  commitHash: z.string().optional(),
  commitMessage: z.string().optional(),
  error: z.string().optional(),
  execution: chatDirectExecutionSchema
}).merge(mutationEnvelopeSchema);

export const deviceTargetsToolOutputSchema = z.object({
  ok: z.literal(true),
  targets: z.array(z.object({
    id: identifierSchema,
    kind: z.literal("device"),
    locality: z.enum(["local", "remote"]),
    displayName: z.string().max(240),
    platform: z.string().max(120),
    architecture: z.string().max(120),
    presence: z.enum(["online", "offline"]),
    executionPolicy: z.enum(["active", "paused"]),
    executionAvailable: z.boolean()
  }))
});
const projectRecordSchema = z.object({
  id: identifierSchema,
  slug: z.string().min(1).max(240),
  displayName: z.string().min(1).max(240),
  defaultWorkspaceId: nullableIdentifierSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().positive()
});

const workspaceRecordSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  repoId: z.string().min(1).max(240),
  kind: z.enum(["checkout", "worktree"]),
  branch: z.string().nullable(),
  headCommit: z.string().nullable(),
  dirty: z.boolean(),
  status: z.enum(["ready", "missing", "blocked", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().positive()
});
const matchingThreadSchema = z.object({
  id: identifierSchema,
  preview: z.string(),
  updatedAt: z.number().nullable(),
  recencyAt: z.number().nullable(),
  sourceKind: z.string().nullable(),
  threadSource: z.string().nullable(),
  name: z.string().nullable().optional(),
  status: z.object({
    type: z.string(),
    activeFlags: z.array(z.string()).optional()
  })
});

const projectMcpApplicabilityServerSchema = z.object({
  name: z.string(),
  enabled: z.boolean()
});

const projectDevelopmentProviderCapabilitySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  observation: z.object({
    status: z.enum(["ready", "degraded", "not-required"]),
    reason: z.string().nullable()
  }),
  source: z.string().nullable(),
  configuredCount: z.number().int().nonnegative().nullable(),
  applicableCount: z.number().int().nonnegative().nullable(),
  disabledCount: z.number().int().nonnegative().nullable(),
  items: z.array(z.object({
    id: z.string(),
    enabled: z.boolean()
  })),
  warnings: z.array(z.string())
});

const projectDevelopmentProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  runtimeKind: z.string(),
  runtimeAvailability: z.enum(["available", "unavailable", "unknown"]),
  observation: z.object({
    status: z.enum(["ready", "degraded", "not-required"]),
    reason: z.string().nullable(),
    latencyBudgetMs: z.number().int().positive()
  }),
  continuation: z.object({
    action: z.enum(["resume", "start", "repair", "unavailable"]),
    reason: z.string(),
    actionIds: z.array(z.string()),
    invokeVia: z.literal("chatcockpit.codex.invoke").nullable(),
    matchingContext: matchingThreadSchema.nullable()
  }),
  capabilities: z.array(projectDevelopmentProviderCapabilitySchema),
  warnings: z.array(z.string())
});

const projectDevelopmentCoordinationSchema = z.object({
  projectId: identifierSchema,
  workspaceId: nullableIdentifierSchema,
  repoId: z.string().nullable(),
  modelLoopOwnership: z.object({
    defaultOwner: z.literal("caller"),
    implicitProviderTurnAllowed: z.literal(false),
    providerTurnRequiresExplicitTransfer: z.literal(true),
    implicitCodexTurnAllowed: z.literal(false),
    codexTurnRequiresExplicitTransfer: z.literal(true)
  }),
  workspaceExecution: z.object({
    kind: z.enum(["checkout", "worktree"]).nullable(),
    mode: z.enum(["native-checkout", "worktree"]).nullable(),
    worktreeRequiresExplicitOptIn: z.literal(true),
    status: z.string().nullable(),
    gitAvailable: z.boolean(),
    branch: z.string().nullable(),
    headCommit: z.string().nullable(),
    detached: z.boolean(),
    dirty: z.boolean()
  }),
  providers: z.array(projectDevelopmentProviderSchema),
  codexContinuity: z.object({
    runtimeAvailable: z.boolean(),
    runtimeAvailability: z.enum(["available", "unavailable", "unknown"]),
    observation: z.object({
      status: z.enum(["ready", "degraded", "not-required"]),
      reason: z.enum([
        "NO_REGISTERED_WORKSPACE",
        "WORKSPACE_NOT_READY",
        "WORKSPACE_DETACHED",
        "CAPABILITIES_TIMEOUT",
        "CAPABILITIES_FAILED",
        "THREADS_TIMEOUT",
        "THREADS_FAILED"
      ]).nullable(),
      latencyBudgetMs: z.number().int().positive()
    }),
    nextAction: z.enum(["resume-native", "start-native", "repair-workspace", "unavailable"]),
    reason: z.string(),
    sessionToolSequence: z.array(z.string()),
    nativeTurnTool: z.literal("chatcockpit.codex.thread.turn.start").nullable(),
    matchingThread: matchingThreadSchema.nullable(),
    warnings: z.array(z.string())
  }),
  mcpApplicability: z.object({
    observation: z.object({
      status: z.enum(["ready", "degraded", "not-required"]),
      reason: z.enum([
        "NO_REGISTERED_WORKSPACE",
        "WORKSPACE_NOT_READY",
        "WORKSPACE_DETACHED",
        "MCP_CONFIG_TIMEOUT",
        "MCP_CONFIG_FAILED"
      ]).nullable()
    }),
    source: z.literal("codex-config").nullable(),
    configuredServerCount: z.number().int().nonnegative().nullable(),
    applicableServerCount: z.number().int().nonnegative().nullable(),
    disabledServerCount: z.number().int().nonnegative().nullable(),
    servers: z.array(projectMcpApplicabilityServerSchema),
    warnings: z.array(z.string())
  }),
  handoff: z.object({
    requiredForModelLoopOwnerChange: z.literal(true),
    sameOwnerResumeRequiresHandoff: z.literal(false),
    recommendedArtifact: z.literal("continuity-capsule")
  })
});

const nativeDevelopmentSchema = z.object({
  projectId: identifierSchema,
  workspaceId: nullableIdentifierSchema,
  repoId: z.string().nullable(),
  preferredLane: z.enum(["codex-native", "chat-direct"]),
  nextAction: z.enum([
    "continue-direct",
    "resume-native",
    "start-native",
    "repair-workspace",
    "direct-fallback"
  ]),
  reason: z.string(),
  nativeRuntimeAvailable: z.boolean(),
  nativeToolSequence: z.array(z.string()),
  matchingThread: matchingThreadSchema.nullable(),
  workspace: z.object({
    status: z.string().nullable(),
    gitAvailable: z.boolean(),
    branch: z.string().nullable(),
    headCommit: z.string().nullable(),
    detached: z.boolean(),
    dirty: z.boolean()
  }),
  warnings: z.array(z.string())
});

const projectProjectionSchema = z.object({
  project: projectRecordSchema,
  workspaces: z.array(workspaceRecordSchema)
});

export const projectListToolOutputSchema = z.object({
  ok: z.literal(true),
  projects: z.array(projectProjectionSchema)
});

export const projectGetToolOutputSchema = z.object({
  ok: z.literal(true),
  project: projectRecordSchema,
  workspaces: z.array(workspaceRecordSchema),
  developmentCoordination: projectDevelopmentCoordinationSchema,
  nativeDevelopment: nativeDevelopmentSchema
});
