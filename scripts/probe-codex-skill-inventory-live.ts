import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../src/application/runtime-resource-hash.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../src/continuity/repositories/index.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { RuntimeSkillProjection } from "../src/runtime/codex/runtime-adapter.ts";
import { CodexRuntimeProfileAdapter } from "../src/runtime/resources/codex-runtime-profile-adapter.ts";

const PROJECT_ID = "project_codex_skill_inventory_live";
const WORKSPACE_ID = "workspace_codex_skill_inventory_live";
const REPO_ID = "codex-skill-inventory-live";
const LIVE_CLIENT_TIMEOUT_MS = 60_000;

type MutableScope = "workspace" | "user";

export interface CodexSkillInventoryLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  totalSkillCount: number;
  mutableSkillCount: number;
  mutableEnabledCount: number;
  mutableDisabledCount: number;
  workspaceEnabledCount: number;
  workspaceDisabledCount: number;
  userEnabledCount: number;
  userDisabledCount: number;
  candidateResourceId: string;
  candidateFingerprint: string;
  candidateScope: MutableScope;
  candidateEnabled: boolean;
  observedProviderMethods: ["skills/list"];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
}

interface PublicSkillCandidate {
  resourceId: string;
  externalId: string;
  fingerprint: string;
  scope: MutableScope;
  enabled: boolean;
}

class TrackingAppServerClient extends CodexAppServerClient {
  constructor(command: string, private readonly observed: Set<string>) {
    super({ command, requestTimeoutMs: LIVE_CLIENT_TIMEOUT_MS });
  }

  override request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    this.observed.add(method);
    return super.request<T>(method, params);
  }
}

function createWorkspaceTruth(
  repositories: ContinuityRepositories,
  workspaceRoot: string
): void {
  const now = new Date().toISOString();
  const project = repositories.projects.create({
    id: PROJECT_ID,
    slug: "codex-skill-inventory-live",
    displayName: "Codex Skill Inventory Live Proof",
    now
  });
  repositories.workspaces.create({
    id: WORKSPACE_ID,
    projectId: project.id,
    repoId: REPO_ID,
    privatePath: workspaceRoot,
    branch: null,
    headCommit: null,
    dirty: false,
    status: "ready",
    now
  });
}

function publicScope(scope: string | null): RuntimeResourceDescriptor["scope"] {
  if (scope === "user") return "user";
  if (["workspace", "project", "repo", "repository"].includes(scope ?? "")) {
    return "workspace";
  }
  if (["system", "runtime", "bundled"].includes(scope ?? "")) return "runtime";
  return "unknown";
}

function candidateFromSkill(
  profile: RuntimeProfileDescriptor,
  skill: RuntimeSkillProjection
): PublicSkillCandidate | null {
  const scope = publicScope(skill.scope);
  if (scope !== "workspace" && scope !== "user") return null;
  const externalId = `skill:${scope}:${skill.name}`;
  const identityExternalId = skill.sourceIdentityHash
    ? `${externalId}:source:${skill.sourceIdentityHash}`
    : externalId;
  const resourceId = buildRuntimeResourceId({
    runtimeProfileId: profile.id,
    kind: "skill",
    externalId: identityExternalId
  });
  const base = {
    id: resourceId,
    runtimeProfileId: profile.id,
    kind: "skill" as const,
    externalId,
    displayName: skill.displayName ?? skill.name,
    description: skill.shortDescription ?? skill.description,
    scope,
    installed: true,
    enabled: skill.enabled,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable" as const,
    authStatus: "not-applicable" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "runtime-native" as const,
    sourceLabel: "Codex",
    capabilities: ["instruction"],
    publicReason: null
  };
  return {
    resourceId,
    externalId,
    fingerprint: hashRuntimeResource(base),
    scope,
    enabled: skill.enabled
  };
}

function selectCandidate(candidates: PublicSkillCandidate[]): PublicSkillCandidate {
  const sorted = [...candidates].sort((left, right) => {
    const rank = (entry: PublicSkillCandidate): number => {
      if (entry.scope === "workspace" && entry.enabled === false) return 0;
      if (entry.scope === "user" && entry.enabled === false) return 1;
      if (entry.scope === "workspace") return 2;
      return 3;
    };
    return (
      rank(left) - rank(right) ||
      left.externalId.localeCompare(right.externalId) ||
      left.resourceId.localeCompare(right.resourceId)
    );
  });
  const candidate = sorted[0];
  assert.ok(candidate, "No mutable workspace/user Codex Skill is available");
  return candidate;
}

export async function runCodexSkillInventoryLiveProof(
  workspaceRootInput = process.cwd()
): Promise<CodexSkillInventoryLiveProofSummary> {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  createWorkspaceTruth(repositories, workspaceRoot);
  const observed = new Set<string>();
  const adapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    createClient: (resolution) =>
      new TrackingAppServerClient(resolution.command, observed)
  });
  const router = new RuntimeRouter(adapter);

  try {
    const profiles = await new CodexRuntimeProfileAdapter(router).listProfiles();
    const profile = profiles[0];
    assert.ok(profile, "Codex Runtime Profile was not produced");
    assert.equal(profile.providerKind, "codex");
    assert.equal(profile.protocolKind, "native-app-server");

    const skills = await router.listCodexSkills({
      workspaceId: WORKSPACE_ID,
      forceReload: true
    });
    const candidates = skills
      .map((skill) => candidateFromSkill(profile, skill))
      .filter((entry): entry is PublicSkillCandidate => entry !== null);
    const candidate = selectCandidate(candidates);
    const count = (scope: MutableScope, enabled: boolean) =>
      candidates.filter((entry) => entry.scope === scope && entry.enabled === enabled).length;

    assert.deepEqual([...observed], ["skills/list"]);
    const summary: CodexSkillInventoryLiveProofSummary = {
      ok: true,
      providerKind: "codex",
      protocolKind: "native-app-server",
      executableVersion: profile.executableVersion,
      totalSkillCount: skills.length,
      mutableSkillCount: candidates.length,
      mutableEnabledCount: candidates.filter((entry) => entry.enabled).length,
      mutableDisabledCount: candidates.filter((entry) => !entry.enabled).length,
      workspaceEnabledCount: count("workspace", true),
      workspaceDisabledCount: count("workspace", false),
      userEnabledCount: count("user", true),
      userDisabledCount: count("user", false),
      candidateResourceId: candidate.resourceId,
      candidateFingerprint: candidate.fingerprint,
      candidateScope: candidate.scope,
      candidateEnabled: candidate.enabled,
      observedProviderMethods: ["skills/list"],
      turnStartObserved: false,
      privateWorkspacePathProjected: false
    };
    const json = JSON.stringify(summary);
    assert.equal(json.includes(workspaceRoot), false);
    assert.equal(json.includes("sourceIdentityHash"), false);
    return summary;
  } finally {
    await router.close().catch(() => undefined);
    database.close();
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runCodexSkillInventoryLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_SKILL_INVENTORY_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_SKILL_INVENTORY_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
