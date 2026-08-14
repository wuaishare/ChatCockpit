import type {
  AsyncRunnerRuntimeBindingKind,
  RunnerRuntimeBindingRecord,
  RuntimeBindingKind,
  RuntimeBindingRecord,
  RuntimeResourceSourceKind
} from "./types.js";

export const LEGACY_ASYNC_RUNNER_RUNTIME_KIND = "tokenpilot-runner" as const;
export const TARGET_ASYNC_RUNNER_RUNTIME_KIND = "async-runner" as const;
export const LEGACY_LOCAL_RESOURCE_SOURCE_KIND = "tokenpilot-local" as const;
export const TARGET_LOCAL_RESOURCE_SOURCE_KIND = "control-plane-local" as const;

export function isAsyncRunnerRuntimeKind(
  value: RuntimeBindingKind | string | null | undefined
): value is AsyncRunnerRuntimeBindingKind {
  return (
    value === LEGACY_ASYNC_RUNNER_RUNTIME_KIND ||
    value === TARGET_ASYNC_RUNNER_RUNTIME_KIND
  );
}

export function isRunnerRuntimeBindingRecord(
  value: RuntimeBindingRecord | null | undefined
): value is RunnerRuntimeBindingRecord {
  return Boolean(value && isAsyncRunnerRuntimeKind(value.runtimeKind));
}

export function isLocalResourceSourceKind(
  value: RuntimeResourceSourceKind | string | null | undefined
): value is "tokenpilot-local" | "control-plane-local" {
  return (
    value === LEGACY_LOCAL_RESOURCE_SOURCE_KIND ||
    value === TARGET_LOCAL_RESOURCE_SOURCE_KIND
  );
}
