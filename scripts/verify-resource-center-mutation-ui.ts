import assert from "node:assert/strict";
import fs from "node:fs";

import {
  isLocalProductActionExecutionPath,
  isProductActionTargetExecutionPath,
  isProductActionTargetAvailable
} from "../web/src/product-action-availability.ts";
import {
  eligibleMutationsForResource,
  isDestructiveMutation,
  mutationApprovalState,
  mutationOperationMatchesResourceState
} from "../web/src/components/resources/resource-mutation-model.ts";
import type {
  ProductActionTargetAvailability,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryResponse,
  RuntimeResourceMutationApproval
} from "../web/src/types.ts";

function resource(
  kind: "skill" | "plugin",
  state: boolean
): RuntimeResourceDescriptor {
  return {
    id: `resource_${kind}`,
    runtimeProfileId: "runtime_profile_ui_fixture",
    kind,
    externalId: `${kind}:fixture`,
    displayName: `${kind} fixture`,
    description: null,
    scope: kind === "skill" ? "user" : "runtime",
    installed: kind === "skill" ? true : state,
    enabled: kind === "skill" ? state : state,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable",
    authStatus: "not-applicable",
    compatibilityStatus: "ready",
    sourceKind: "runtime-native",
    sourceLabel: "Codex",
    capabilities: ["this-field-must-not-drive-ui-mutation-policy"],
    publicReason: null,
    fingerprint: "a".repeat(64)
  };
}

const skillEnabled = resource("skill", true);
const pluginMissing = resource("plugin", false);
const inventory = {
  ok: true,
  snapshot: {
    id: "snapshot_ui_fixture",
    runtimeProfileId: "runtime_profile_ui_fixture",
    providerKind: "codex",
    protocolKind: "native-app-server",
    status: "ready",
    profile: {},
    fingerprint: "b".repeat(64),
    capturedAt: "2026-08-11T00:00:00.000Z",
    revision: 1,
    items: []
  },
  profile: {
    id: "runtime_profile_ui_fixture",
    providerKind: "codex",
    protocolKind: "native-app-server",
    displayName: "Codex",
    executableSource: "bundled",
    executableVersion: "fixture",
    protocolVersion: "2.0",
    compatibilityStatus: "ready",
    homeIdentityHash: null,
    authStatus: "ready",
    capabilities: [],
    publicReason: null
  },
  resources: [skillEnabled, pluginMissing],
  mutationWritesEnabled: true,
  mutationEligibility: [
    {
      resourceId: skillEnabled.id,
      snapshotId: "snapshot_ui_fixture",
      operations: [
        {
          operation: "skill.enable",
          eligible: false,
          code: "already-requested-state",
          stage: "state",
          publicReason: "Already enabled"
        },
        {
          operation: "skill.disable",
          eligible: true,
          code: "eligible",
          stage: "eligible",
          publicReason: "Eligible"
        }
      ]
    },
    {
      resourceId: pluginMissing.id,
      snapshotId: "snapshot_ui_fixture",
      operations: [
        {
          operation: "plugin.install",
          eligible: false,
          code: "deployment-policy-fixture",
          stage: "policy",
          publicReason: "Fixture says no"
        },
        {
          operation: "plugin.uninstall",
          eligible: false,
          code: "already-requested-state",
          stage: "state",
          publicReason: "Not installed"
        }
      ]
    }
  ],
  diagnostics: [],
  diff: {
    previousSnapshotId: null,
    added: [],
    removed: [],
    changed: [],
    unchanged: []
  },
  replayed: false
} satisfies RuntimeResourceInventoryResponse;

assert.deepEqual(
  eligibleMutationsForResource(inventory, skillEnabled.id).map(
    (operation) => operation.operation
  ),
  ["skill.disable"]
);
assert.deepEqual(
  eligibleMutationsForResource(inventory, pluginMissing.id),
  [],
  "UI mutation actions must follow server eligibility even when Resource fields look mutable"
);
assert.equal(
  mutationOperationMatchesResourceState(skillEnabled, "skill.enable"),
  true
);
assert.equal(
  mutationOperationMatchesResourceState(skillEnabled, "skill.disable"),
  false
);
assert.equal(
  mutationOperationMatchesResourceState(pluginMissing, "plugin.uninstall"),
  true
);
assert.equal(
  mutationOperationMatchesResourceState(undefined, "plugin.uninstall"),
  false
);
assert.equal(isDestructiveMutation("plugin.uninstall"), true);
assert.equal(isDestructiveMutation("plugin.install"), false);

const approvalRequiredLocalTarget = {
  deviceId: "local-device",
  displayName: "This device",
  locality: "local",
  platform: "darwin",
  architecture: "arm64",
  presence: "online",
  availability: "approval-required",
  executionMode: "local-runtime",
  reason: "approval-required"
} satisfies ProductActionTargetAvailability;
const unsupportedRemoteTarget = {
  deviceId: "remote-device",
  displayName: "Remote device",
  locality: "remote",
  platform: "darwin",
  architecture: "arm64",
  presence: "online",
  availability: "unsupported",
  executionMode: "none",
  reason: "target-capability-not-implemented"
} satisfies ProductActionTargetAvailability;

assert.equal(
  isProductActionTargetAvailable(approvalRequiredLocalTarget),
  false,
  "approval-required must not be reclassified as immediately available"
);
assert.equal(
  isProductActionTargetExecutionPath(approvalRequiredLocalTarget),
  true,
  "approval-required local-runtime is a legitimate governed execution path"
);
assert.equal(
  isLocalProductActionExecutionPath(approvalRequiredLocalTarget),
  true
);
assert.equal(
  isProductActionTargetExecutionPath(unsupportedRemoteTarget),
  false,
  "unimplemented remote Resource RPC must remain fail-closed"
);
assert.equal(
  isLocalProductActionExecutionPath(unsupportedRemoteTarget),
  false
);

const approval = {
  id: "approval_ui_fixture",
  operation: "plugin.install",
  runtimeProfileId: "runtime_profile_ui_fixture",
  workspaceId: "workspace_ui_fixture",
  resourceId: pluginMissing.id,
  resourceKind: "plugin",
  resourceScope: "runtime",
  beforeSnapshotId: "snapshot_ui_fixture",
  beforeFingerprint: pluginMissing.fingerprint,
  requestedState: { installed: true },
  publicSummary: {
    beforeInstalled: false,
    requestedInstalled: true
  },
  requestedActor: null,
  decidedActor: null,
  status: "pending",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-08-11T00:05:00.000Z",
  decidedAt: null,
  consumedAt: null,
  revision: 1
} satisfies RuntimeResourceMutationApproval;
assert.deepEqual(mutationApprovalState(approval), {
  before: false,
  requested: true
});

const helperSource = fs.readFileSync(
  new URL(
    "../web/src/components/resources/resource-mutation-model.ts",
    import.meta.url
  ),
  "utf8"
);
assert.equal(
  helperSource.includes(".capabilities"),
  false,
  "Resource Center mutation policy must never parse Resource capabilities"
);
assert.equal(helperSource.includes("plugin:install-policy"), false);
assert.equal(helperSource.includes("plugin:auth-policy"), false);

const resourceCenterSource = fs.readFileSync(
  new URL(
    "../web/src/components/resources/ResourceCenterView.tsx",
    import.meta.url
  ),
  "utf8"
);
const reviewSource = fs.readFileSync(
  new URL(
    "../web/src/components/resources/ResourceMutationReview.tsx",
    import.meta.url
  ),
  "utf8"
);
const workflowSource = fs.readFileSync(
  new URL(
    "../web/src/components/resources/use-resource-mutation-workflow.ts",
    import.meta.url
  ),
  "utf8"
);
const cssSource = fs.readFileSync(
  new URL(
    "../web/src/components/resources/resource-center.css",
    import.meta.url
  ),
  "utf8"
);

for (const requiredOperation of [
  "useResourceMutationWorkflow",
  "eligibleMutationsForResource",
  "productActionTargets",
  "runtime.resource.mutate",
  "isLocalProductActionExecutionPath",
  "mutationExecutionPathAvailable",
  "mutationWritesEnabled",
  "prepareMutation",
  "ResourceMutationActivity",
  "reopenPendingMutation"
]) {
  assert.equal(
    resourceCenterSource.includes(requiredOperation),
    true,
    `Resource Center must wire ${requiredOperation}`
  );
}
for (const requiredLifecycleOperation of [
  "prepareRuntimeResourceMutation",
  "decideRuntimeResourceMutation",
  "executeRuntimeResourceMutation",
  "fetchRuntimeResourceMutationActivity",
  "mutationOperationMatchesResourceState"
]) {
  assert.equal(
    workflowSource.includes(requiredLifecycleOperation),
    true,
    `Resource mutation workflow must own ${requiredLifecycleOperation}`
  );
}

const prepareFlow = workflowSource.match(
  /async function prepareMutation[\s\S]*?(?=\n  async function recoverMutationEvidence)/
)?.[0];
assert.ok(prepareFlow, "Prepare flow must remain inspectable");
assert.equal(prepareFlow.includes("prepareRuntimeResourceMutation"), true);
assert.equal(
  prepareFlow.includes("expectedSnapshotId: inventory.snapshot.id"),
  true,
  "Prepare must bind the mutation intent to the exact inventory snapshot reviewed by the operator"
);
assert.equal(
  prepareFlow.includes("decideRuntimeResourceMutation"),
  false,
  "The first Resource action click must prepare only"
);
assert.equal(
  prepareFlow.includes("executeRuntimeResourceMutation"),
  false,
  "Prepare must never execute the provider mutation"
);

const approveFlow = workflowSource.match(
  /async function approveAndExecuteMutation[\s\S]*?(?=\n  async function denyMutation)/
)?.[0];
assert.ok(approveFlow, "Approve-and-execute flow must remain inspectable");
const decisionIndex = approveFlow.indexOf("decideRuntimeResourceMutation");
const executeIndex = approveFlow.indexOf("executeRuntimeResourceMutation");
const refreshIndex = approveFlow.indexOf("readAuthoritativeInventory(", executeIndex);
const matchIndex = approveFlow.indexOf("mutationOperationMatchesResourceState", refreshIndex);
assert.equal(decisionIndex >= 0, true);
assert.equal(executeIndex > decisionIndex, true, "Decision must persist before execute");
assert.equal(refreshIndex > executeIndex, true, "Terminal execute must be followed by authoritative inventory refresh");
assert.equal(matchIndex > refreshIndex, true, "Success must compare refreshed authoritative state");
assert.equal(
  approveFlow.includes('executionResult.execution.verificationStatus === "verified"'),
  true,
  "UI success must require verified execution evidence"
);

assert.equal(
  workflowSource.includes("!mutationExecutionPathAvailable"),
  true,
  "Resource mutation must fail closed when Product Action resolution has no governed local execution path"
);
assert.equal(
  workflowSource.indexOf("!mutationExecutionPathAvailable") <
    workflowSource.indexOf("!inventory.mutationWritesEnabled"),
  true,
  "Product Action target resolution must be evaluated before deployment mutation exposure"
);
assert.equal(
  workflowSource.includes("!inventory.mutationWritesEnabled"),
  true,
  "Exposure-disabled deployments must be rejected by the workflow before request"
);
assert.equal(
  resourceCenterSource.includes("mutationExecutionPathAvailable") &&
    resourceCenterSource.includes("mutationWritesEnabled") &&
    resourceCenterSource.includes("disabled={mutationDisabled}"),
  true,
  "Mutation actions must visibly combine target resolution with deployment exposure"
);
assert.equal(
  resourceCenterSource.includes("onRefreshProductActions()"),
  true,
  "Resource inventory refresh must also refresh Product Action target projection instead of leaving device availability stale"
);
assert.equal(
  resourceCenterSource.includes("target-capability-not-implemented"),
  true,
  "Resource Center must preserve the explicit remote-not-implemented recovery reason"
);
assert.equal(
  resourceCenterSource.includes("target-capability-not-attested"),
  true,
  "Resource Center must not collapse current capability non-attestation into upgrade-required"
);
assert.equal(
  resourceCenterSource.includes("device-agent-update-required"),
  true,
  "Legacy protocol gaps must retain their bounded Agent-update recovery reason"
);
assert.equal(
  resourceCenterSource.includes("if (mutationBusy || profileId === selectedProfileId) return"),
  true,
  "Runtime Profile selection must remain locked while a governed mutation is in flight"
);
assert.equal(
  resourceCenterSource.includes("disabled={mutationBusy}"),
  true,
  "Workspace/Profile controls must expose a busy-disabled state during mutation execution"
);
assert.equal(
  workflowSource.includes("setMutationActivity(null)"),
  true,
  "Mutation workflow reset must clear stale mutation activity"
);
assert.equal(
  reviewSource.includes("maskClosable={!busy}"),
  true,
  "Busy mutation review must not dismiss through the modal mask"
);
assert.equal(
  reviewSource.includes("danger={destructive}"),
  true,
  "Plugin uninstall must remain visually differentiated as destructive"
);
assert.equal(
  reviewSource.includes('entry.status === "pending"'),
  true,
  "Persisted pending approvals must remain reopenable after reload"
);
assert.equal(
  reviewSource.includes("onReviewApproval"),
  true,
  "Mutation activity must expose a review callback for pending approvals"
);
assert.equal(
  cssSource.includes("@media (max-width: 650px)"),
  true,
  "Mutation UI must retain narrow-view responsive rules"
);
assert.equal(
  cssSource.includes(".resource-center__mutation-target") &&
    cssSource.includes("grid-template-columns: minmax(0, 1fr)"),
  true,
  "Mutation target rows must collapse safely on narrow views"
);
assert.equal(
  cssSource.includes("resource-center__mutation-activity-item"),
  true,
  "Durable mutation activity must have a dedicated responsive presentation"
);
for (const forbidden of [
  "chatcockpit.resources.mutation.prepare",
  "chatcockpit.resources.mutation.decide",
  "chatcockpit.resources.mutation.execute"
]) {
  assert.equal(
    `${resourceCenterSource}\n${reviewSource}\n${workflowSource}`.includes(forbidden),
    false,
    `6B2C2 Resource Center must not depend on MCP mutation surface ${forbidden}`
  );
}

process.stdout.write("VERIFY_RESOURCE_CENTER_MUTATION_UI_OK\n");
