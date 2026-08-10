import assert from "node:assert/strict";
import fs from "node:fs";

import {
  eligibleMutationsForResource,
  isDestructiveMutation,
  mutationApprovalState,
  mutationOperationMatchesResourceState
} from "../web/src/components/resources/resource-mutation-model.ts";
import type {
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
  workflowSource.includes("!inventory.mutationWritesEnabled"),
  true,
  "Exposure-disabled deployments must be rejected by the workflow before request"
);
assert.equal(
  resourceCenterSource.includes("mutationWritesEnabled") &&
    resourceCenterSource.includes("disabled={mutationDisabled}"),
  true,
  "Exposure-disabled deployments must visibly disable mutation actions"
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
  cssSource.includes("resource-center__mutation-activity-item"),
  true,
  "Durable mutation activity must have a dedicated responsive presentation"
);
for (const forbidden of [
  "tokenpilot.resources.mutation.prepare",
  "tokenpilot.resources.mutation.decide",
  "tokenpilot.resources.mutation.execute"
]) {
  assert.equal(
    `${resourceCenterSource}\n${reviewSource}\n${workflowSource}`.includes(forbidden),
    false,
    `6B2C2 Resource Center must not depend on MCP mutation surface ${forbidden}`
  );
}

process.stdout.write("VERIFY_RESOURCE_CENTER_MUTATION_UI_OK\n");
