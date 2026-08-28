import type { RuntimePrivateThreadLocationPage } from "../runtime/codex/runtime-adapter.js";
import {
  CodexLocalProjectStateReader,
  type CodexLocalProjectStateReading
} from "../runtime/codex/local-project-state.js";
import type { OperationContext } from "./operation-context.js";
import type {
  ProjectRootDiscoveryObservationSet,
  ProjectRootDiscoverySource
} from "./project-root-discovery-source.js";

const MAX_PAGES = 4;
const PAGE_SIZE = 100;

export interface CodexProjectRootDiscoveryRuntime {
  listPrivateCodexThreadLocations(
    context: OperationContext,
    input?: { cursor?: string | null; limit?: number }
  ): Promise<RuntimePrivateThreadLocationPage>;
}

/**
 * Codex contributes machine-local project catalog roots plus native thread cwd evidence.
 * The coordinator remains provider-neutral and resolves/deduplicates physical ProjectRoots.
 */
export class CodexProjectRootDiscoverySource implements ProjectRootDiscoverySource {
  readonly id = "codex-native-history";
  readonly displayName = "Codex";

  constructor(
    private readonly runtime: CodexProjectRootDiscoveryRuntime,
    private readonly localState: CodexLocalProjectStateReading = new CodexLocalProjectStateReader()
  ) {}

  async discover(context: OperationContext): Promise<ProjectRootDiscoveryObservationSet> {
    const observations: ProjectRootDiscoveryObservationSet["observations"] = [];
    const local = this.localState.readProjectRoots();
    let inspectedContexts = local.inspectedContexts;
    let cursor: string | null = null;
    let truncated = false;

    for (const root of local.roots) {
      observations.push({
        sourceContextId: root.sourceContextId,
        privatePath: root.privatePath,
        label: root.label,
        observedAt: root.observedAt,
        signalKind: root.signalKind,
        resolution: "exact-directory"
      });
    }

    try {
      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
        const page = await this.runtime.listPrivateCodexThreadLocations(context, {
          cursor,
          limit: PAGE_SIZE
        });
        inspectedContexts += page.data.length;
        for (const thread of page.data) {
          observations.push({
            sourceContextId: thread.threadId,
            privatePath: thread.privatePath,
            label: thread.name,
            observedAt: thread.updatedAt,
            signalKind: "native-session-cwd",
            resolution: "git-top-level"
          });
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        if (pageIndex === MAX_PAGES - 1) truncated = true;
      }
    } catch (error) {
      if (!local.available) throw error;
    }

    return { observations, inspectedContexts, truncated };
  }
}
