import type { TokenPilotPaths } from "../types.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
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

  return new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(options.codexStandaloneStore),
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
