import { productIdentityForKey } from "../core/product-identity.js";
import type { ProductIdentityKey } from "../types.js";
import type { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import type { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";
import type {
  DirectCapabilityAccess,
  DirectCapabilityId,
  DirectExecutionScope,
  DirectExecutorCapability,
  DirectExecutorDescriptor,
  DirectExecutorSource
} from "./capability-broker.js";

const WORKSPACE_SCOPE: DirectExecutionScope[] = ["workspace"];

function capability(
  id: DirectCapabilityId,
  access: DirectCapabilityAccess[]
): DirectExecutorCapability {
  return {
    id,
    scopes: [...WORKSPACE_SCOPE],
    access: [...access]
  };
}

const BUILT_IN_DIRECT_CAPABILITIES: DirectExecutorCapability[] = [
  capability("files.read", ["read"]),
  capability("files.readBatch", ["read"]),
  capability("files.list", ["read"]),
  capability("files.write", ["write"]),
  capability("files.edit", ["write"]),
  capability("search.content", ["read"]),
  capability("shell.exec", ["read", "write"]),
  capability("git.status", ["read"]),
  capability("git.diff", ["read"]),
  capability("git.commit", ["write"]),
  capability("git.log", ["read"])
];

export function createBuiltInDirectExecutorSource(
  productIdentity: ProductIdentityKey = "tokenpilot"
): DirectExecutorSource {
  const identity = productIdentityForKey(productIdentity);
  return {
    describe(): DirectExecutorDescriptor {
      return {
        id: identity.builtInDirectExecutorId,
        kind: "built-in",
        displayName: `${identity.displayName} Built-in`,
        health: "ready",
        scopes: [...WORKSPACE_SCOPE],
        capabilities: BUILT_IN_DIRECT_CAPABILITIES.map((entry) => ({
          ...entry,
          scopes: [...entry.scopes],
          access: [...entry.access]
        }))
      };
    }
  };
}

export function createTokenPilotDirectExecutorSource(): DirectExecutorSource {
  return createBuiltInDirectExecutorSource("tokenpilot");
}

function isVerified(
  store: CodexStandaloneCapabilityStore,
  operation: "files.read" | "files.write" | "files.list" | "command.exec"
): boolean {
  const snapshot = store.read();
  const operationCapability = snapshot?.operations[operation];
  return Boolean(
    snapshot?.directExecutionReady &&
      !snapshot.turnStartObserved &&
      operationCapability?.status === "verified" &&
      operationCapability.safeForChatDirect
  );
}

export function createDownstreamMcpExecutorSource(
  store: DownstreamMcpCapabilityStore,
  executorId: string,
  displayName = executorId
): DirectExecutorSource {
  return {
    describe(): DirectExecutorDescriptor {
      const snapshot = store.read(executorId);
      if (!snapshot) {
        return {
          id: executorId,
          kind: "downstream-mcp",
          displayName,
          health: "unavailable",
          scopes: [],
          capabilities: []
        };
      }

      const verified = snapshot.mappings.filter(
        (mapping) => mapping.status === "verified"
      );
      return {
        id: snapshot.executorId,
        kind: "downstream-mcp",
        displayName: snapshot.displayName,
        health: snapshot.health,
        scopes: Array.from(
          new Set(verified.flatMap((mapping) => mapping.scopes))
        ),
        capabilities: verified.map((mapping) => ({
          id: mapping.capability,
          scopes: [...mapping.scopes],
          access: [...mapping.access]
        }))
      };
    }
  };
}

export function createCodexStandaloneExecutorSource(
  store: CodexStandaloneCapabilityStore
): DirectExecutorSource {
  return {
    describe(): DirectExecutorDescriptor {
      const snapshot = store.read();
      const ready = Boolean(
        snapshot?.directExecutionReady && !snapshot.turnStartObserved
      );
      const capabilities: DirectExecutorCapability[] = [];

      if (isVerified(store, "files.read")) {
        capabilities.push(
          capability("files.read", ["read"]),
          capability("files.readBatch", ["read"])
        );
      }
      if (isVerified(store, "files.list")) {
        capabilities.push(capability("files.list", ["read"]));
      }
      if (isVerified(store, "files.write")) {
        capabilities.push(capability("files.write", ["write"]));
      }
      if (isVerified(store, "command.exec")) {
        capabilities.push(capability("shell.exec", ["read"]));
      }

      return {
        id: "codex-app-server-standalone",
        kind: "app-server-standalone",
        displayName: "Codex App Server Standalone",
        health: ready ? "ready" : "unavailable",
        scopes: [...WORKSPACE_SCOPE],
        capabilities
      };
    }
  };
}
