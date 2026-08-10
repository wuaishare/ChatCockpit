import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.ts";
import {
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "../src/application/runtime-resource-hash.ts";
import { assessRuntimeResourceMutationEligibility } from "../src/application/runtime-resource-mutation-eligibility.ts";
import type { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { RuntimeResourceMutationOperation } from "../src/continuity/repositories/runtime-resource-mutation-repository.ts";
import type { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";

const NOW = "2026-08-10T18:15:00.000Z";
const workspaceId = "workspace_eligibility_fixture";

const profile: RuntimeProfileDescriptor = {
  id: "runtime_profile_eligibility_fixture",
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.skills", "resources.plugins"],
  publicReason: null
};

function withFingerprint(
  input: Omit<RuntimeResourceDescriptor, "fingerprint">
): RuntimeResourceDescriptor {
  return { ...input, fingerprint: hashRuntimeResource(input) };
}

function skill(input: {
  installed?: boolean | null;
  enabled?: boolean | null;
  compatibilityStatus?: RuntimeResourceDescriptor["compatibilityStatus"];
} = {}): RuntimeResourceDescriptor {
  return withFingerprint({
    id: "resource_skill_eligibility_fixture",
    runtimeProfileId: profile.id,
    kind: "skill",
    externalId: "skill:user:eligibility-fixture",
    displayName: "Eligibility Skill",
    description: null,
    scope: "user",
    installed: Object.hasOwn(input, "installed") ? input.installed! : true,
    enabled: Object.hasOwn(input, "enabled") ? input.enabled! : false,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable",
    authStatus: "not-applicable",
    compatibilityStatus: input.compatibilityStatus ?? "ready",
    sourceKind: "runtime-native",
    sourceLabel: "Codex",
    capabilities: ["instruction"],
    publicReason: null
  });
}

function plugin(input: {
  installed?: boolean | null;
  compatibilityStatus?: RuntimeResourceDescriptor["compatibilityStatus"];
  capabilities?: string[];
} = {}): RuntimeResourceDescriptor {
  const installed = Object.hasOwn(input, "installed") ? input.installed! : false;
  return withFingerprint({
    id: "resource_plugin_eligibility_fixture",
    runtimeProfileId: profile.id,
    kind: "plugin",
    externalId: "plugin:eligibility-fixture@marketplace",
    displayName: "Eligibility Plugin",
    description: null,
    scope: "runtime",
    installed,
    enabled: installed,
    version: installed ? "1.0.0" : null,
    availableVersion: "1.0.0",
    updateStatus: installed ? "current" : "not-applicable",
    authStatus: "unknown",
    compatibilityStatus: input.compatibilityStatus ?? "ready",
    sourceKind: "runtime-native",
    sourceLabel: "Codex:marketplace",
    capabilities:
      input.capabilities ??
      [
        "plugin:source:remote",
        "plugin:install-policy:available",
        "plugin:auth-policy:on-use",
        "plugin:installation-interstitial:false",
        "plugin:observed:catalog"
      ],
    publicReason: null
  });
}

interface EligibilityCase {
  name: string;
  resource: RuntimeResourceDescriptor;
  operation: RuntimeResourceMutationOperation;
  profile?: RuntimeProfileDescriptor;
  pluginMutationAvailable?: boolean;
  eligible: boolean;
  code: string;
}

const basePlugin = plugin();
const installedPlugin = plugin({ installed: true });
const cases: EligibilityCase[] = [
  {
    name: "skill enable",
    resource: skill({ enabled: false }),
    operation: "skill.enable",
    eligible: true,
    code: "eligible"
  },
  {
    name: "skill enable no-op",
    resource: skill({ enabled: true }),
    operation: "skill.enable",
    eligible: false,
    code: "already-requested-state"
  },
  {
    name: "skill installed required",
    resource: skill({ installed: false, enabled: false }),
    operation: "skill.enable",
    eligible: false,
    code: "skill-not-installed"
  },
  {
    name: "skill state required",
    resource: skill({ enabled: null }),
    operation: "skill.enable",
    eligible: false,
    code: "resource-state-unknown"
  },
  {
    name: "plugin install",
    resource: plugin({ installed: false }),
    operation: "plugin.install",
    eligible: true,
    code: "eligible"
  },
  {
    name: "plugin adapter required",
    resource: plugin({ installed: false }),
    operation: "plugin.install",
    pluginMutationAvailable: false,
    eligible: false,
    code: "plugin-mutation-unavailable"
  },
  {
    name: "plugin install auth policy",
    resource: plugin({
      capabilities: basePlugin.capabilities
        .filter((entry) => entry !== "plugin:auth-policy:on-use")
        .concat("plugin:auth-policy:on-install")
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-install-auth-policy-unsupported"
  },
  {
    name: "plugin install unknown interstitial",
    resource: plugin({
      capabilities: basePlugin.capabilities.filter(
        (entry) => entry !== "plugin:installation-interstitial:false"
      )
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-install-interstitial-unsupported"
  },
  {
    name: "plugin install true interstitial",
    resource: plugin({
      capabilities: basePlugin.capabilities
        .filter((entry) => entry !== "plugin:installation-interstitial:false")
        .concat("plugin:installation-interstitial:true")
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-install-interstitial-unsupported"
  },
  {
    name: "plugin install local source",
    resource: plugin({
      capabilities: basePlugin.capabilities
        .filter((entry) => entry !== "plugin:source:remote")
        .concat("plugin:source:local")
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-install-source-unsupported"
  },
  {
    name: "plugin install policy",
    resource: plugin({
      capabilities: basePlugin.capabilities.filter(
        (entry) => entry !== "plugin:install-policy:available"
      )
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-install-policy-unsupported"
  },
  {
    name: "plugin install catalog observation",
    resource: plugin({
      capabilities: basePlugin.capabilities.filter(
        (entry) => entry !== "plugin:observed:catalog"
      )
    }),
    operation: "plugin.install",
    eligible: false,
    code: "plugin-catalog-observation-required"
  },
  {
    name: "plugin uninstall",
    resource: installedPlugin,
    operation: "plugin.uninstall",
    eligible: true,
    code: "eligible"
  },
  {
    name: "plugin uninstall no-op",
    resource: plugin({ installed: false }),
    operation: "plugin.uninstall",
    eligible: false,
    code: "already-requested-state"
  },
  {
    name: "plugin uninstall installed by default",
    resource: plugin({
      installed: true,
      capabilities: installedPlugin.capabilities.concat(
        "plugin:install-policy:installed-by-default"
      )
    }),
    operation: "plugin.uninstall",
    eligible: false,
    code: "plugin-uninstall-installed-by-default"
  },
  {
    name: "plugin uninstall catalog observation",
    resource: plugin({
      installed: true,
      capabilities: installedPlugin.capabilities.filter(
        (entry) => entry !== "plugin:observed:catalog"
      )
    }),
    operation: "plugin.uninstall",
    eligible: false,
    code: "plugin-catalog-observation-required"
  },
  {
    name: "runtime provider mismatch",
    resource: skill({ enabled: false }),
    operation: "skill.enable",
    profile: { ...profile, providerKind: "other-runtime" },
    eligible: false,
    code: "runtime-profile-unsupported"
  },
  {
    name: "runtime protocol mismatch",
    resource: skill({ enabled: false }),
    operation: "skill.enable",
    profile: { ...profile, protocolKind: "other-protocol" },
    eligible: false,
    code: "runtime-profile-unsupported"
  },
  {
    name: "resource kind mismatch",
    resource: plugin({ installed: false }),
    operation: "skill.enable",
    eligible: false,
    code: "resource-kind-mismatch"
  },
  {
    name: "compatibility blocked",
    resource: plugin({ installed: false, compatibilityStatus: "blocked" }),
    operation: "plugin.install",
    eligible: false,
    code: "resource-compatibility-not-ready"
  }
];

for (const testCase of cases) {
  const result = assessRuntimeResourceMutationEligibility({
    profile: testCase.profile ?? profile,
    resource: testCase.resource,
    operation: testCase.operation,
    pluginMutationAvailable: testCase.pluginMutationAvailable ?? true
  });
  assert.equal(result.eligible, testCase.eligible, testCase.name);
  assert.equal(result.code, testCase.code, testCase.name);
  assert.equal(result.publicReason.length > 0, true, testCase.name);
  assert.equal(result.publicReason.length <= 240, true, testCase.name);
  assert.equal(JSON.stringify(result).includes("marketplacePath"), false);
  assert.equal(JSON.stringify(result).includes("remotePluginId"), false);
}

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
try {
  repositories.projects.create({
    id: "project_eligibility_fixture",
    slug: "eligibility-fixture",
    displayName: "Eligibility Fixture",
    now: NOW
  });
  repositories.workspaces.create({
    id: workspaceId,
    projectId: "project_eligibility_fixture",
    repoId: "repo_eligibility_fixture",
    privatePath: "/private/tokenpilot-runtime-sentinel/eligibility-workspace",
    now: NOW
  });

  let parityProfile = profile;
  let parityResource = skill({ enabled: false });
  const fakeInventory = {
    inventory: async () => {
      throw new Error("Eligibility parity must not use full Runtime Resource inventory");
    },
    inspectSnapshotResource: (snapshotId: string, resourceId: string) => {
      const snapshot = repositories.runtimeResourceSnapshots.get(snapshotId);
      const item = snapshot.items.find((entry) => entry.resourceId === resourceId);
      assert.ok(item, "Eligibility parity reviewed snapshot must contain target");
      return {
        snapshot,
        resource: {
          id: item.resourceId,
          runtimeProfileId: snapshot.runtimeProfileId,
          kind: item.kind,
          externalId: item.externalId,
          displayName: item.displayName,
          description: item.description,
          scope: item.scope,
          installed: item.installed,
          enabled: item.enabled,
          version: item.version,
          availableVersion: item.availableVersion,
          updateStatus: item.updateStatus,
          authStatus: item.authStatus,
          compatibilityStatus: item.compatibilityStatus,
          sourceKind: item.sourceKind,
          sourceLabel: item.sourceLabel,
          capabilities: [...item.capabilities],
          publicReason: item.publicReason,
          fingerprint: item.fingerprint
        }
      };
    },
    readTarget: async (input: {
      runtimeProfileId: string;
      workspaceId?: string;
      resourceId: string;
      resourceKind: "skill" | "plugin";
    }) => {
      assert.equal(input.runtimeProfileId, parityProfile.id);
      assert.equal(input.workspaceId, workspaceId);
      assert.equal(input.resourceId, parityResource.id);
      assert.equal(input.resourceKind, parityResource.kind);
      return {
        profile: parityProfile,
        resource: parityResource,
        diagnostics: []
      };
    }
  } as unknown as RuntimeResourceInventoryService;

  const noWriteSkillAdapter = {
    setEnabled: async () => {
      throw new Error("Eligibility prepare parity must never execute a Skill write");
    }
  } as unknown as CodexSkillMutationAdapter;
  const noWritePluginAdapter = {
    install: async () => {
      throw new Error("Eligibility prepare parity must never execute a Plugin write");
    },
    uninstall: async () => {
      throw new Error("Eligibility prepare parity must never execute a Plugin write");
    }
  } as unknown as CodexPluginMutationAdapter;
  const context = buildOperationContext({
    requestId: "eligibility-parity-request",
    actorType: "local-ui",
    actorId: "eligibility-parity-operator",
    now: NOW
  });

  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index]!;
    parityProfile = testCase.profile ?? profile;
    parityResource = testCase.resource;
    const service = new RuntimeResourceMutationService(
      repositories,
      fakeInventory,
      noWriteSkillAdapter,
      {
        now: () => NOW,
        ...(testCase.pluginMutationAvailable === false
          ? {}
          : { codexPlugins: noWritePluginAdapter })
      }
    );
    const reviewedSnapshot = repositories.runtimeResourceSnapshots.create({
      runtimeProfileId: parityProfile.id,
      providerKind: parityProfile.providerKind,
      protocolKind: parityProfile.protocolKind,
      status: "ready",
      profile: parityProfile as unknown as Record<string, unknown>,
      fingerprint: hashRuntimeResourceSnapshot(parityProfile, [parityResource]),
      items: [
        {
          resourceId: parityResource.id,
          kind: parityResource.kind,
          externalId: parityResource.externalId,
          displayName: parityResource.displayName,
          description: parityResource.description,
          scope: parityResource.scope,
          installed: parityResource.installed,
          enabled: parityResource.enabled,
          version: parityResource.version,
          availableVersion: parityResource.availableVersion,
          updateStatus: parityResource.updateStatus,
          authStatus: parityResource.authStatus,
          compatibilityStatus: parityResource.compatibilityStatus,
          sourceKind: parityResource.sourceKind,
          sourceLabel: parityResource.sourceLabel,
          capabilities: parityResource.capabilities,
          publicReason: parityResource.publicReason,
          fingerprint: parityResource.fingerprint
        }
      ],
      now: new Date(Date.parse(NOW) + index * 1000).toISOString()
    });
    const request = {
      operation: testCase.operation,
      runtimeProfileId: parityProfile.id,
      workspaceId,
      resourceId: parityResource.id,
      expectedSnapshotId: reviewedSnapshot.id,
      expectedFingerprint: parityResource.fingerprint,
      idempotencyKey: `eligibility-parity-${index}`
    };

    if (testCase.eligible) {
      const prepared = await service.prepare(context, request);
      assert.equal(prepared.approval.status, "pending", testCase.name);
      continue;
    }

    const expectedServiceCode =
      testCase.code === "already-requested-state"
        ? "RUNTIME_RESOURCE_MUTATION_NOOP"
        : "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED";
    await assert.rejects(
      () => service.prepare(context, request),
      (error: unknown) =>
        error instanceof ServiceError && error.code === expectedServiceCode,
      `Service/evaluator eligibility parity failed: ${testCase.name}`
    );
  }
} finally {
  database.close();
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_ELIGIBILITY_OK\n");
