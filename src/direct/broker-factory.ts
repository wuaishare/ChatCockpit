import type { TokenPilotPaths } from "../types.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import { resolveCodexBinary } from "../runtime/codex/binary.js";
import { DirectCapabilityBroker } from "./capability-broker.js";
import { loadDownstreamMcpExecutorsConfig } from "./downstream-mcp-config.js";
import { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";
import {
  createBuiltInDirectExecutorSource,
  createCodexStandaloneExecutorSource,
  createDownstreamMcpExecutorSource
} from "./executor-sources.js";

export function buildConfiguredDirectCapabilityBroker(options: {
  paths: TokenPilotPaths;
  codexStandaloneStore: CodexStandaloneCapabilityStore;
  downstreamConfigPath?: string;
}): DirectCapabilityBroker {
  const config = loadDownstreamMcpExecutorsConfig(options.downstreamConfigPath);
  const downstreamStore = new DownstreamMcpCapabilityStore(options.paths.runtimeDir);
  const identity = productIdentityForKey(options.paths.productIdentity);
  let currentCodexBinary: { source: string | null; version: string | null } | null = null;
  try {
    const resolution = resolveCodexBinary();
    currentCodexBinary = { source: resolution.source, version: resolution.version };
  } catch {
    currentCodexBinary = null;
  }

  return new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(
      options.codexStandaloneStore,
      currentCodexBinary
    ),
    createBuiltInDirectExecutorSource(options.paths.productIdentity),
    ...config.executors.map((executor) =>
      createDownstreamMcpExecutorSource(
        downstreamStore,
        executor.id,
        executor.displayName
      )
    )
  ], {
    executorAliases: identity.directExecutorInputAliases
  });
}
