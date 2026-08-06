import type {
  CodexThreadListInput,
  CodexThreadReadInput
} from "../contracts/codex-runtime.js";
import type {
  RuntimeCapabilitySnapshot,
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

  listCodexThreads(
    _context: OperationContext,
    input: CodexThreadListInput
  ): Promise<RuntimeThreadListResult> {
    return this.runtime.listCodexThreads(input);
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
