export type DirectExecutionScope = "workspace" | "host";
export type DirectCapabilityAccess = "read" | "write";

export type DirectCapabilityId =
  | "files.read"
  | "files.readBatch"
  | "files.list"
  | "files.write"
  | "files.edit"
  | "search.content"
  | "shell.exec"
  | "git.status"
  | "git.diff"
  | "git.commit"
  | "git.log";

export type DirectExecutorKind =
  | "built-in"
  | "app-server-standalone"
  | "downstream-mcp";

export type DirectExecutorHealth = "ready" | "degraded" | "unavailable";

export interface DirectExecutorCapability {
  id: DirectCapabilityId;
  scopes: DirectExecutionScope[];
  access: DirectCapabilityAccess[];
}

export interface DirectExecutorDescriptor {
  id: string;
  kind: DirectExecutorKind;
  displayName: string;
  health: DirectExecutorHealth;
  scopes: DirectExecutionScope[];
  capabilities: DirectExecutorCapability[];
}

export interface DirectExecutorSource {
  describe(): DirectExecutorDescriptor;
}

export interface DirectCapabilityRequest {
  capability: DirectCapabilityId;
  scope: DirectExecutionScope;
  access: DirectCapabilityAccess;
  executorId?: string;
}

export interface DirectExecutorSelection {
  executorId: string;
  executorKind: DirectExecutorKind;
  capability: DirectCapabilityId;
  scope: DirectExecutionScope;
  access: DirectCapabilityAccess;
  selectionMode: "automatic" | "explicit";
}

export interface DirectCapabilityBrokerOptions {
  executorAliases?: Readonly<Record<string, string>>;
}

export class DirectCapabilityBrokerError extends Error {
  constructor(
    readonly code:
      | "DIRECT_EXECUTOR_NOT_FOUND"
      | "DIRECT_EXECUTOR_UNAVAILABLE"
      | "DIRECT_EXECUTOR_UNSUPPORTED"
      | "DIRECT_CAPABILITY_UNAVAILABLE",
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "DirectCapabilityBrokerError";
  }
}

function cloneDescriptor(
  descriptor: DirectExecutorDescriptor
): DirectExecutorDescriptor {
  return {
    ...descriptor,
    scopes: [...descriptor.scopes],
    capabilities: descriptor.capabilities.map((capability) => ({
      ...capability,
      scopes: [...capability.scopes],
      access: [...capability.access]
    }))
  };
}

function supports(
  descriptor: DirectExecutorDescriptor,
  request: DirectCapabilityRequest
): boolean {
  if (descriptor.health === "unavailable") {
    return false;
  }
  if (!descriptor.scopes.includes(request.scope)) {
    return false;
  }
  const capability = descriptor.capabilities.find(
    (entry) => entry.id === request.capability
  );
  return Boolean(
    capability?.scopes.includes(request.scope) &&
      capability.access.includes(request.access)
  );
}

export class DirectCapabilityBroker {
  private readonly executorAliases: Readonly<Record<string, string>>;

  constructor(
    private readonly sources: DirectExecutorSource[],
    options: DirectCapabilityBrokerOptions = {}
  ) {
    this.executorAliases = options.executorAliases ?? {};
  }

  catalog(): DirectExecutorDescriptor[] {
    return this.sources.map((source) => cloneDescriptor(source.describe()));
  }

  resolve(request: DirectCapabilityRequest): DirectExecutorSelection {
    const descriptors = this.catalog();

    if (request.executorId) {
      const resolvedExecutorId =
        this.executorAliases[request.executorId] ?? request.executorId;
      const descriptor = descriptors.find(
        (entry) => entry.id === resolvedExecutorId
      );
      if (!descriptor) {
        throw new DirectCapabilityBrokerError(
          "DIRECT_EXECUTOR_NOT_FOUND",
          `Direct executor ${request.executorId} is not registered`,
          {
            executorId: request.executorId,
            resolvedExecutorId,
            capability: request.capability,
            scope: request.scope,
            access: request.access
          }
        );
      }
      if (descriptor.health === "unavailable") {
        throw new DirectCapabilityBrokerError(
          "DIRECT_EXECUTOR_UNAVAILABLE",
          `Direct executor ${request.executorId} is currently unavailable`,
          {
            executorId: request.executorId,
            health: descriptor.health,
            capability: request.capability,
            scope: request.scope,
            access: request.access
          }
        );
      }
      if (!supports(descriptor, request)) {
        throw new DirectCapabilityBrokerError(
          "DIRECT_EXECUTOR_UNSUPPORTED",
          `Direct executor ${request.executorId} does not support ${request.capability} for ${request.scope}/${request.access}`,
          {
            executorId: request.executorId,
            capability: request.capability,
            scope: request.scope,
            access: request.access
          }
        );
      }
      return {
        executorId: descriptor.id,
        executorKind: descriptor.kind,
        capability: request.capability,
        scope: request.scope,
        access: request.access,
        selectionMode: "explicit"
      };
    }

    const descriptor = descriptors.find((entry) => supports(entry, request));
    if (!descriptor) {
      throw new DirectCapabilityBrokerError(
        "DIRECT_CAPABILITY_UNAVAILABLE",
        `No direct executor can satisfy ${request.capability} for ${request.scope}/${request.access}`,
        {
          capability: request.capability,
          scope: request.scope,
          access: request.access
        }
      );
    }

    return {
      executorId: descriptor.id,
      executorKind: descriptor.kind,
      capability: request.capability,
      scope: request.scope,
      access: request.access,
      selectionMode: "automatic"
    };
  }
}
