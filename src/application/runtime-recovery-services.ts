import type { TokenPilotPaths } from "../types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import { NativeCodexRecoveryAdapter } from "../runtime/recovery/native-codex-recovery-adapter.js";
import { RunnerRecoveryAdapter } from "../runtime/recovery/runner-recovery-adapter.js";
import { ChatDirectRecoveryAdapter } from "../runtime/recovery/chat-direct-recovery-adapter.js";
import { RuntimeRecoveryAdapterRegistry } from "../runtime/recovery/runtime-recovery-adapter-registry.js";
import { AsyncRunnerRecoverySource } from "../runtime/recovery/runner-recovery-source.js";
import type { RuntimeRouter } from "./runtime-router.js";
import type { RuntimeBindingService } from "./runtime-binding-service.js";
import type { HandoffService } from "./handoff-service.js";
import type { WorkspaceContinuityService } from "./workspace-continuity-service.js";
import { RuntimeRecoveryAssessmentService } from "./runtime-recovery-assessment-service.js";
import { RuntimeRecoveryExecutionService } from "./runtime-recovery-execution-service.js";
import { productIdentityForKey } from "../core/product-identity.js";

export interface RuntimeRecoveryServices {
  adapters: RuntimeRecoveryAdapterRegistry;
  assessment: RuntimeRecoveryAssessmentService;
  execution: RuntimeRecoveryExecutionService;
  repositories: ContinuityRepositories;
}

export function buildRuntimeRecoveryServices(input: {
  paths: TokenPilotPaths;
  repositories: ContinuityRepositories;
  runtimeRouter: RuntimeRouter;
  workspaceContinuity: WorkspaceContinuityService;
  runtimeBindingService: RuntimeBindingService;
  handoffService: HandoffService;
}): RuntimeRecoveryServices {
  const identity = productIdentityForKey(input.paths.productIdentity);
  const adapters = new RuntimeRecoveryAdapterRegistry([
    new NativeCodexRecoveryAdapter(input.runtimeRouter),
    new RunnerRecoveryAdapter(
      new AsyncRunnerRecoverySource(input.paths, input.repositories),
      { protocolFamily: identity.asyncRunnerRuntimeKind }
    ),
    new ChatDirectRecoveryAdapter()
  ]);
  const assessment = new RuntimeRecoveryAssessmentService(
    input.repositories,
    adapters,
    input.workspaceContinuity
  );
  const execution = new RuntimeRecoveryExecutionService(
    input.repositories,
    assessment,
    adapters,
    input.runtimeBindingService,
    input.handoffService
  );
  return {
    adapters,
    assessment,
    execution,
    repositories: input.repositories
  };
}
