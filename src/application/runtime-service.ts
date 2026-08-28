import type {
  CodexNativeContextReadInput,
  CodexThreadListInput,
  CodexThreadReadInput
} from "../contracts/codex-runtime.js";
import type {
  RuntimeCapabilitySnapshot,
  RuntimeMcpApplicabilityProjection,
  RuntimeNativeContextProjection,
  RuntimePrivateThreadLocationPage,
  RuntimeThreadListResult,
  RuntimeThreadProjection
} from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";

export class RuntimeService {
  constructor(private readonly runtime: RuntimeRouter) {}

  capabilities(_context: OperationContext): Promise<RuntimeCapabilitySnapshot> {
    return this.runtime.capabilities();
  }

  readCodexNativeContext(
    _context: OperationContext,
    input: CodexNativeContextReadInput
  ): Promise<RuntimeNativeContextProjection> {
    return this.runtime.readCodexNativeContext(input);
  }

  readCodexMcpApplicability(
    _context: OperationContext,
    workspaceId: string
  ): Promise<RuntimeMcpApplicabilityProjection> {
    return this.runtime.readCodexMcpApplicability({ workspaceId });
  }

  listCodexThreads(
    _context: OperationContext,
    input: CodexThreadListInput
  ): Promise<RuntimeThreadListResult> {
    return this.runtime.listCodexThreads(input);
  }

  listPrivateCodexThreadLocations(
    _context: OperationContext,
    input: { cursor?: string | null; limit?: number } = {}
  ): Promise<RuntimePrivateThreadLocationPage> {
    return this.runtime.listPrivateCodexThreadLocations(input);
  }

  readCodexThread(
    _context: OperationContext,
    input: CodexThreadReadInput
  ): Promise<RuntimeThreadProjection> {
    return this.runtime.readCodexThread(input);
  }

  close(): Promise<void> {
    return this.runtime.close();
  }
}
