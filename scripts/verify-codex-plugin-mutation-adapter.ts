import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import type { WorkspaceRepository } from "../src/continuity/repositories/workspace-repository.ts";
import {
  codexPluginSourceIdentityHash,
  mergeCodexPluginProjections,
  normalizeCodexPluginResponse
} from "../src/runtime/codex/app-server-adapter.ts";
import type { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { RuntimePluginProjection } from "../src/runtime/codex/runtime-adapter.ts";
import {
  CODEX_PLUGIN_MUTATION_REQUEST_TIMEOUT_MS,
  CodexPluginMutationAdapter
} from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import { buildCodexPluginResourceDescriptor } from "../src/runtime/resources/codex-plugin-resource-projector.ts";

const privateWorkspacePath = "/private/chatcockpit-runtime-sentinel/plugin-workspace";
const marketplaceName = "fixture-remote-marketplace";
const providerPluginId = "fixture-remote-plugin@fixture-remote-marketplace";
const pluginName = "fixture-remote-plugin";
const remotePluginId = "plugins~Plugin_fixture_remote_backend_id";

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "plugin-mutation-fixture"
  }),
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "codex-cli fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.plugins"],
  publicReason: null
};

assert.equal(CODEX_PLUGIN_MUTATION_REQUEST_TIMEOUT_MS, 60_000);

interface PluginStateOverrides {
  sourceType?: "remote" | "local";
  authPolicy?: string | null;
  installPolicy?: string | null;
  installPolicySource?: string | null;
  interstitial?: boolean | null;
  availability?: string | null;
  displayName?: string;
}

function rawPlugin(installed: boolean, overrides: PluginStateOverrides = {}) {
  const source =
    overrides.sourceType === "local"
      ? { type: "local", path: `${privateWorkspacePath}/private-plugin-source` }
      : { type: "remote" };
  return {
    id: providerPluginId,
    name: pluginName,
    remotePluginId: overrides.sourceType === "local" ? null : remotePluginId,
    localVersion: installed ? "1.0.0" : null,
    version: "1.0.0",
    installed,
    enabled: installed,
    availability: overrides.availability ?? "AVAILABLE",
    installPolicy: overrides.installPolicy ?? "AVAILABLE",
    installPolicySource: overrides.installPolicySource ?? "WORKSPACE_SETTING",
    mustShowInstallationInterstitial:
      overrides.interstitial === undefined ? false : overrides.interstitial,
    authPolicy: overrides.authPolicy ?? "ON_USE",
    source,
    interface: {
      displayName: overrides.displayName ?? "Fixture Remote Plugin",
      shortDescription: "Fixture remote Plugin mutation target",
      category: "Engineering",
      capabilities: ["Read"]
    }
  };
}

function providerResponse(
  installed: boolean,
  overrides: PluginStateOverrides = {}
): { installed: unknown; catalog: unknown } {
  const marketplace = {
    name: marketplaceName,
    path: null,
    interface: null
  };
  return {
    installed: {
      marketplaces: installed
        ? [{ ...marketplace, plugins: [rawPlugin(true, overrides)] }]
        : [],
      marketplaceLoadErrors: []
    },
    catalog: {
      marketplaces: [
        { ...marketplace, plugins: [rawPlugin(installed, overrides)] }
      ],
      marketplaceLoadErrors: []
    }
  };
}

function expectedProjection(
  installed: boolean,
  overrides: PluginStateOverrides = {}
): RuntimePluginProjection {
  const responses = providerResponse(installed, overrides);
  return mergeCodexPluginProjections(
    normalizeCodexPluginResponse(responses.installed, "installed"),
    normalizeCodexPluginResponse(responses.catalog, "catalog")
  )[0]!;
}

const originalResource = buildCodexPluginResourceDescriptor(
  profile,
  expectedProjection(false)
);
const installedResource = buildCodexPluginResourceDescriptor(
  profile,
  expectedProjection(true)
);
assert.notEqual(originalResource.fingerprint, installedResource.fingerprint);
assert.equal(originalResource.id, installedResource.id);

const workspaces = {
  getPrivate: (id: string) => {
    assert.equal(id, "workspace_fixture");
    return { id, privatePath: privateWorkspacePath };
  }
} as unknown as WorkspaceRepository;

function makeClient(options: {
  initialInstalled?: boolean;
  overrides?: PluginStateOverrides;
}) {
  let installed = options.initialInstalled ?? false;
  const observedMethods: string[] = [];
  const writeParams: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown) => {
      observedMethods.push(method);
      const responses = providerResponse(installed, options.overrides);
      if (method === "plugin/installed") {
        assert.deepEqual(params, { cwds: [privateWorkspacePath] });
        return responses.installed;
      }
      if (method === "plugin/list") {
        assert.deepEqual(params, {
          cwds: [privateWorkspacePath],
          forceRefetch: true
        });
        return responses.catalog;
      }
      if (method === "plugin/install") {
        writeParams.push({ method, params });
        assert.deepEqual(params, {
          pluginName: remotePluginId,
          remoteMarketplaceName: marketplaceName
        });
        installed = true;
        return { appsNeedingAuth: [], authPolicy: "ON_USE" };
      }
      if (method === "plugin/uninstall") {
        writeParams.push({ method, params });
        assert.deepEqual(params, { pluginId: remotePluginId });
        installed = false;
        return {};
      }
      throw new Error(`unexpected method ${method}`);
    },
    close: async () => undefined
  } as unknown as CodexAppServerClient;
  return {
    client,
    observedMethods,
    writeParams,
    installed: () => installed
  };
}

function adapterFor(client: CodexAppServerClient): CodexPluginMutationAdapter {
  return new CodexPluginMutationAdapter({
    workspaces,
    resolveBinary: () => ({
      command: "codex-fixture",
      source: "configured",
      version: "codex-cli fixture",
      attempts: []
    }),
    createClient: () => client
  });
}

const installFixture = makeClient({});
const installAdapter = adapterFor(installFixture.client);
const installResult = await installAdapter.install({
  profile,
  workspaceId: "workspace_fixture",
  resourceId: originalResource.id,
  expectedFingerprint: originalResource.fingerprint
});
assert.deepEqual(installResult, {
  authPolicy: "ON_USE",
  appsNeedingAuthCount: 0
});
assert.equal(installFixture.installed(), true);
assert.deepEqual(installFixture.observedMethods, [
  "plugin/installed",
  "plugin/list",
  "plugin/install"
]);
assert.equal(installFixture.writeParams.length, 1);

const siblingRemotePluginId = "plugins~Plugin_sibling_backend_id";
const multiSourceObservedMethods: string[] = [];
const multiSourceWriteParams: Array<{ method: string; params: unknown }> = [];
const multiSourceClient = {
  request: async (method: string, params: unknown) => {
    multiSourceObservedMethods.push(method);
    if (method === "plugin/installed") {
      assert.deepEqual(params, { cwds: [privateWorkspacePath] });
      return { marketplaces: [], marketplaceLoadErrors: [] };
    }
    if (method === "plugin/list") {
      assert.deepEqual(params, {
        cwds: [privateWorkspacePath],
        forceRefetch: true
      });
      const sibling = {
        ...rawPlugin(false),
        remotePluginId: siblingRemotePluginId,
        interface: {
          ...rawPlugin(false).interface,
          displayName: "Same Provider / Distinct Source"
        }
      };
      return {
        marketplaces: [
          {
            name: marketplaceName,
            path: null,
            interface: null,
            plugins: [rawPlugin(false), sibling]
          }
        ],
        marketplaceLoadErrors: []
      };
    }
    if (method === "plugin/install") {
      multiSourceWriteParams.push({ method, params });
      assert.deepEqual(params, {
        pluginName: remotePluginId,
        remoteMarketplaceName: marketplaceName
      });
      return { appsNeedingAuth: [], authPolicy: "ON_USE" };
    }
    throw new Error(`unexpected method ${method}`);
  },
  close: async () => undefined
} as unknown as CodexAppServerClient;
const multiSourceInstallResult = await adapterFor(multiSourceClient).install({
  profile,
  workspaceId: "workspace_fixture",
  resourceId: originalResource.id,
  expectedFingerprint: originalResource.fingerprint
});
assert.deepEqual(multiSourceInstallResult, {
  authPolicy: "ON_USE",
  appsNeedingAuthCount: 0
});
assert.deepEqual(multiSourceObservedMethods, [
  "plugin/installed",
  "plugin/list",
  "plugin/install"
]);
assert.equal(multiSourceWriteParams.length, 1);

const uninstallFixture = makeClient({ initialInstalled: true });
const uninstallAdapter = adapterFor(uninstallFixture.client);
await uninstallAdapter.uninstall({
  profile,
  workspaceId: "workspace_fixture",
  resourceId: installedResource.id,
  expectedFingerprint: installedResource.fingerprint
});
assert.equal(uninstallFixture.installed(), false);
assert.deepEqual(uninstallFixture.observedMethods, [
  "plugin/installed",
  "plugin/list",
  "plugin/uninstall"
]);
assert.equal(uninstallFixture.writeParams.length, 1);

async function expectInstallRejected(
  overrides: PluginStateOverrides,
  expectedCode = "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED"
): Promise<void> {
  const fixture = makeClient({ overrides });
  const target = buildCodexPluginResourceDescriptor(
    profile,
    expectedProjection(false, overrides)
  );
  await assert.rejects(
    () =>
      adapterFor(fixture.client).install({
        profile,
        workspaceId: "workspace_fixture",
        resourceId: target.id,
        expectedFingerprint: target.fingerprint
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === expectedCode
  );
  assert.equal(
    fixture.writeParams.length,
    0,
    `Unsafe install policy ${JSON.stringify(overrides)} reached provider mutation`
  );
}

await expectInstallRejected({ authPolicy: "ON_INSTALL" });
await expectInstallRejected({ interstitial: true });
await expectInstallRejected({ interstitial: null });
await expectInstallRejected({ sourceType: "local" });
await expectInstallRejected({ installPolicy: "INSTALLED_BY_DEFAULT" });
await expectInstallRejected({ availability: "DISABLED_BY_ADMIN" });

const staleFixture = makeClient({
  overrides: { displayName: "Changed After Approval" }
});
await assert.rejects(
  () =>
    adapterFor(staleFixture.client).install({
      profile,
      workspaceId: "workspace_fixture",
      resourceId: originalResource.id,
      expectedFingerprint: originalResource.fingerprint
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.equal(staleFixture.writeParams.length, 0);

const defaultInstalledPolicy = {
  ...expectedProjection(true),
  installPolicy: "INSTALLED_BY_DEFAULT"
};
const defaultInstalledResource = buildCodexPluginResourceDescriptor(
  profile,
  defaultInstalledPolicy
);
const defaultUninstallFixture = makeClient({
  initialInstalled: true,
  overrides: { installPolicy: "INSTALLED_BY_DEFAULT" }
});
await assert.rejects(
  () =>
    adapterFor(defaultUninstallFixture.client).uninstall({
      profile,
      workspaceId: "workspace_fixture",
      resourceId: defaultInstalledResource.id,
      expectedFingerprint: defaultInstalledResource.fingerprint
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED"
);
assert.equal(defaultUninstallFixture.writeParams.length, 0);

const publicResultJson = JSON.stringify({ installResult });
for (const forbidden of [
  privateWorkspacePath,
  "private-plugin-source",
  "remoteMarketplaceName",
  "marketplacePath",
  "installUrl"
]) {
  assert.equal(publicResultJson.includes(forbidden), false);
}

const identityHash = codexPluginSourceIdentityHash(
  { name: marketplaceName, path: null },
  { type: "remote" },
  remotePluginId
);
const driftedIdentityHash = codexPluginSourceIdentityHash(
  { name: marketplaceName, path: null },
  { type: "remote" },
  "plugins~Plugin_different_backend_id"
);
assert.match(identityHash ?? "", /^[a-f0-9]{64}$/);
assert.match(driftedIdentityHash ?? "", /^[a-f0-9]{64}$/);
assert.notEqual(
  identityHash,
  driftedIdentityHash,
  "Remote backend Plugin id drift must change the opaque source identity"
);

process.stdout.write("VERIFY_CODEX_PLUGIN_MUTATION_ADAPTER_OK\n");
