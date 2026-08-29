import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../core/product-identity.js";
import type { ProductIdentityKey } from "../types.js";
import {
  assessCodexStandaloneSnapshot,
  type CodexStandaloneCapabilityStore
} from "../runtime/codex/standalone-capabilities.js";
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
const WORKSPACE_AND_HOST_SCOPE: DirectExecutionScope[] = ["workspace", "host"];

function capability(
  id: DirectCapabilityId,
  access: DirectCapabilityAccess[],
  scopes: DirectExecutionScope[] = WORKSPACE_SCOPE
): DirectExecutorCapability {
  return {
    id,
    scopes: [...scopes],
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
  capability("shell.exec", ["read", "write"], WORKSPACE_AND_HOST_SCOPE),
  capability("git.status", ["read"]),
  capability("git.diff", ["read"]),
  capability("git.stage", ["write"]),
  capability("git.commit", ["write"]),
  capability("git.log", ["read"])
];

export function createBuiltInDirectExecutorSource(
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): DirectExecutorSource {
  const identity = productIdentityForKey(productIdentity);
  return {
    describe(): DirectExecutorDescriptor {
      return {
        id: identity.builtInDirectExecutorId,
        kind: "built-in",
        displayName: `${identity.displayName} Built-in`,
        health: "ready",
        scopes: [...WORKSPACE_AND_HOST_SCOPE],
        capabilities: BUILT_IN_DIRECT_CAPABILITIES.map((entry) => ({
          ...entry,
          scopes: [...entry.scopes],
          access: [...entry.access]
        }))
      };
    }
  };
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

export type CodexStandaloneCurrentBinary =
  | { source: string | null; version: string | null }
  | null
  | undefined;

export function createCodexStandaloneExecutorSource(
  store: CodexStandaloneCapabilityStore,
  currentBinary?:
    | CodexStandaloneCurrentBinary
    | (() => CodexStandaloneCurrentBinary)
): DirectExecutorSource {
  return {
    describe(): DirectExecutorDescriptor {
      const snapshot = store.read();
      const currentBinarySupplied = currentBinary !== undefined;
      const observedCurrentBinary =
        typeof currentBinary === "function" ? currentBinary() : currentBinary;
      const fresh = currentBinarySupplied
        ? observedCurrentBinary != null &&
          assessCodexStandaloneSnapshot(snapshot, observedCurrentBinary).state === "ready"
        : Boolean(snapshot);
      const ready = Boolean(
        fresh && snapshot?.directExecutionReady && !snapshot.turnStartObserved
      );
      const capabilities: DirectExecutorCapability[] = [];

      if (ready && isVerified(store, "files.read")) {
        capabilities.push(
          capability("files.read", ["read"]),
          capability("files.readBatch", ["read"])
        );
      }
      if (ready && isVerified(store, "files.list")) {
        capabilities.push(capability("files.list", ["read"]));
      }
      if (ready && isVerified(store, "files.write")) {
        capabilities.push(capability("files.write", ["write"]));
      }
      if (ready && isVerified(store, "command.exec")) {
        capabilities.push(capability("shell.exec", ["read", "write"]));
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
