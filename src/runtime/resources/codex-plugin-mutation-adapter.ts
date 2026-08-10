import { ServiceError } from "../../application/service-error.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../../application/runtime-resource-types.js";
import type { WorkspaceRepository } from "../../continuity/repositories/workspace-repository.js";
import {
  codexPluginSourceIdentityHash,
  mergeCodexPluginProjections,
  normalizeCodexPluginResponse
} from "../codex/app-server-adapter.js";
import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "../codex/binary.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";
import type { RuntimePluginProjection } from "../codex/runtime-adapter.js";
import { buildCodexPluginResourceDescriptor } from "./codex-plugin-resource-projector.js";

export const CODEX_PLUGIN_MUTATION_REQUEST_TIMEOUT_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface PrivatePluginSelector {
  providerPluginId: string;
  pluginName: string;
  remoteMarketplaceName: string;
}

interface PrivatePluginTarget {
  projection: RuntimePluginProjection;
  resource: RuntimeResourceDescriptor;
  selector: PrivatePluginSelector | null;
}

export interface CodexPluginMutationInput {
  profile: RuntimeProfileDescriptor;
  workspaceId: string;
  resourceId: string;
  expectedFingerprint: string;
}

export interface CodexPluginInstallResult {
  authPolicy: string | null;
  appsNeedingAuthCount: number;
}

export interface CodexPluginMutationAdapterOptions {
  workspaces: WorkspaceRepository;
  resolveBinary?: () => CodexBinaryResolution;
  createClient?: (resolution: CodexBinaryResolution) => CodexAppServerClient;
}

function pluginProjectionKey(plugin: RuntimePluginProjection): string {
  return `${plugin.id}:${plugin.sourceIdentityHash ?? "unknown-source"}`;
}

function catalogSelectors(value: unknown): Map<string, PrivatePluginSelector> {
  const response = asRecord(value);
  const rawMarketplaces = Array.isArray(response.marketplaces)
    ? response.marketplaces
    : [];
  const selectors = new Map<string, PrivatePluginSelector>();
  for (const rawMarketplace of rawMarketplaces) {
    const marketplace = asRecord(rawMarketplace);
    if (typeof marketplace.name !== "string" || !marketplace.name) continue;
    const rawPlugins = Array.isArray(marketplace.plugins)
      ? marketplace.plugins
      : [];
    for (const rawPlugin of rawPlugins) {
      const plugin = asRecord(rawPlugin);
      if (typeof plugin.id !== "string" || !plugin.id) continue;
      const pluginName =
        typeof plugin.name === "string" && plugin.name
          ? plugin.name
          : plugin.id;
      const sourceIdentityHash = codexPluginSourceIdentityHash(
        marketplace,
        plugin.source
      );
      const key = `${plugin.id}:${sourceIdentityHash ?? "unknown-source"}`;
      const selector = {
        providerPluginId: plugin.id,
        pluginName,
        remoteMarketplaceName: marketplace.name
      };
      const existing = selectors.get(key);
      if (
        existing &&
        (existing.providerPluginId !== selector.providerPluginId ||
          existing.pluginName !== selector.pluginName ||
          existing.remoteMarketplaceName !== selector.remoteMarketplaceName)
      ) {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS",
          "The approved Codex Plugin resolves to conflicting private catalog selectors"
        );
      }
      selectors.set(key, selector);
    }
  }
  return selectors;
}

export class CodexPluginMutationAdapter {
  private readonly workspaces: WorkspaceRepository;
  private readonly binaryResolver: () => CodexBinaryResolution;
  private readonly clientFactory: (
    resolution: CodexBinaryResolution
  ) => CodexAppServerClient;

  constructor(options: CodexPluginMutationAdapterOptions) {
    this.workspaces = options.workspaces;
    this.binaryResolver = options.resolveBinary ?? (() => resolveCodexBinary());
    this.clientFactory =
      options.createClient ??
      ((resolution) =>
        new CodexAppServerClient({
          command: resolution.command,
          requestTimeoutMs: CODEX_PLUGIN_MUTATION_REQUEST_TIMEOUT_MS
        }));
  }

  async install(input: CodexPluginMutationInput): Promise<CodexPluginInstallResult> {
    this.assertNativeCodexProfile(input.profile);
    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const client = this.clientFactory(this.binaryResolver());
    try {
      const target = await this.resolveTarget(
        client,
        input.profile,
        workspace.privatePath,
        input.resourceId,
        input.expectedFingerprint
      );
      this.assertInstallSupported(target);
      const selector = target.selector!;
      const response = asRecord(
        await client.request<unknown>("plugin/install", {
          pluginName: selector.pluginName,
          remoteMarketplaceName: selector.remoteMarketplaceName
        })
      );
      return {
        authPolicy:
          typeof response.authPolicy === "string" ? response.authPolicy : null,
        appsNeedingAuthCount: Array.isArray(response.appsNeedingAuth)
          ? response.appsNeedingAuth.length
          : 0
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
        "Codex Plugin install failed"
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async uninstall(input: CodexPluginMutationInput): Promise<void> {
    this.assertNativeCodexProfile(input.profile);
    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const client = this.clientFactory(this.binaryResolver());
    try {
      const target = await this.resolveTarget(
        client,
        input.profile,
        workspace.privatePath,
        input.resourceId,
        input.expectedFingerprint
      );
      this.assertUninstallSupported(target);
      await client.request<unknown>("plugin/uninstall", {
        pluginId: target.selector!.providerPluginId
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
        "Codex Plugin uninstall failed"
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private assertNativeCodexProfile(profile: RuntimeProfileDescriptor): void {
    if (
      profile.providerKind !== "codex" ||
      profile.protocolKind !== "native-app-server"
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Codex Plugin mutation requires a native Codex App Server profile"
      );
    }
  }

  private async resolveTarget(
    client: CodexAppServerClient,
    profile: RuntimeProfileDescriptor,
    privateWorkspacePath: string,
    resourceId: string,
    expectedFingerprint: string
  ): Promise<PrivatePluginTarget> {
    const installedParams = { cwds: [privateWorkspacePath] };
    const catalogParams = {
      cwds: [privateWorkspacePath],
      forceRefetch: true
    };
    const [installedResponse, catalogResponse] = await Promise.all([
      client.request<unknown>("plugin/installed", installedParams),
      client.request<unknown>("plugin/list", catalogParams)
    ]);
    const installed = normalizeCodexPluginResponse(
      installedResponse,
      "installed"
    );
    const catalog = normalizeCodexPluginResponse(catalogResponse, "catalog");
    const projections = mergeCodexPluginProjections(installed, catalog);

    const sourceIdentitiesByPluginId = new Map<string, Set<string>>();
    for (const plugin of projections) {
      const identities =
        sourceIdentitiesByPluginId.get(plugin.id) ?? new Set<string>();
      identities.add(plugin.sourceIdentityHash ?? "unknown-source");
      sourceIdentitiesByPluginId.set(plugin.id, identities);
    }
    if (
      [...sourceIdentitiesByPluginId.values()].some(
        (identities) => identities.size > 1
      )
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS",
        "Codex Plugin provider identity resolves to multiple live source identities"
      );
    }

    const selectors = catalogSelectors(catalogResponse);
    const targets = projections.map((projection) => ({
      projection,
      resource: buildCodexPluginResourceDescriptor(profile, projection),
      selector: selectors.get(pluginProjectionKey(projection)) ?? null
    }));
    const matching = targets.filter(
      (target) => target.resource.id === resourceId
    );
    if (matching.length === 0) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
        "The approved Codex Plugin is no longer present in the live Runtime inventory"
      );
    }
    if (matching.length !== 1) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS",
        "The approved Codex Plugin no longer resolves to exactly one private Runtime target"
      );
    }
    const target = matching[0]!;
    if (target.resource.fingerprint !== expectedFingerprint) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "The Codex Plugin changed after approval and must be reviewed again"
      );
    }
    return target;
  }

  private assertInstallSupported(target: PrivatePluginTarget): void {
    const plugin = target.projection;
    if (
      target.resource.kind !== "plugin" ||
      target.resource.compatibilityStatus !== "ready" ||
      plugin.installed !== false ||
      plugin.sourceType !== "remote" ||
      plugin.availability !== "AVAILABLE" ||
      plugin.installPolicy !== "AVAILABLE" ||
      plugin.authPolicy !== "ON_USE" ||
      plugin.mustShowInstallationInterstitial !== false ||
      !target.selector ||
      !plugin.observedBy.includes("catalog")
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Phase 6B2B Plugin install only supports authoritative remote AVAILABLE ON_USE catalog Plugins with no installation interstitial"
      );
    }
  }

  private assertUninstallSupported(target: PrivatePluginTarget): void {
    const plugin = target.projection;
    if (
      target.resource.kind !== "plugin" ||
      target.resource.compatibilityStatus !== "ready" ||
      plugin.installed !== true ||
      plugin.installPolicy === "INSTALLED_BY_DEFAULT" ||
      !target.selector ||
      !plugin.observedBy.includes("catalog")
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Phase 6B2B Plugin uninstall only supports installed, compatible, catalog-backed Plugins that are not installed by default"
      );
    }
  }
}
