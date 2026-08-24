import type {
  RuntimeApprovalKind,
  RuntimeEventCategory,
  RuntimeEventRecord
} from "../continuity/types.js";
import type { ActivityControlEventRecord } from "./activity-control-event-port.js";
import type { JobControlAction, JobProcessState } from "../core/job-processes.js";
import type {
  DeviceRuntimeOperationAction,
  DeviceRuntimeOperationRecord,
  DeviceRuntimeOperationState
} from "../governance/device-runtime-operation-repository.js";

export type OperationalActivityEventKind =
  | "run-started"
  | "run-completed"
  | "run-failed"
  | "run-interrupted"
  | "job-paused"
  | "job-resumed"
  | "job-terminated"
  | "step-started"
  | "step-completed"
  | "approval-required"
  | "approval-resolved"
  | "approval-rejected"
  | "warning"
  | "error"
  | "device-operation-updated"
  | "activity";

export interface OperationalActivityEventProjection {
  id: string;
  activityId: string;
  source: "runtime" | "job-control" | "device-operation";
  sequence: number;
  kind: OperationalActivityEventKind;
  category: RuntimeEventCategory | "control" | "device-operation";
  approvalKind: RuntimeApprovalKind | null;
  itemType: string | null;
  code: string | null;
  controlAction: JobControlAction | null;
  resultingState: JobProcessState | null;
  processRevision: number | null;
  deviceAction: DeviceRuntimeOperationAction | null;
  deviceOperationState: DeviceRuntimeOperationState | null;
  createdAt: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,80}$/;
const APPROVAL_KINDS = new Set<RuntimeApprovalKind>([
  "command-execution",
  "file-change",
  "permissions",
  "unsupported"
]);

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SAFE_TOKEN.test(normalized) ? normalized : null;
}

function approvalKind(value: unknown): RuntimeApprovalKind | null {
  const normalized = safeToken(value) as RuntimeApprovalKind | null;
  return normalized && APPROVAL_KINDS.has(normalized) ? normalized : null;
}

function eventKind(event: RuntimeEventRecord): OperationalActivityEventKind {
  const status = safeToken(event.publicPayload.status);
  if (event.method === "turn/started") return "run-started";
  if (event.method === "turn/completed") {
    if (status === "failed") return "run-failed";
    if (status === "interrupted") return "run-interrupted";
    return "run-completed";
  }
  if (event.method === "item/started") return "step-started";
  if (event.method === "item/completed") return "step-completed";
  if (event.category === "approval") {
    if (event.method === "approval/rejectedUnsupported" || status === "stale" || status === "cancelled") {
      return "approval-rejected";
    }
    if (status === "responded" || status === "resolved") return "approval-resolved";
    return "approval-required";
  }
  if (event.category === "error") return "error";
  if (event.category === "warning") return "warning";
  return "activity";
}

export function projectOperationalActivityEvent(
  event: RuntimeEventRecord
): OperationalActivityEventProjection {
  return {
    id: event.id,
    activityId: event.sessionId,
    source: "runtime",
    sequence: event.sequence,
    kind: eventKind(event),
    category: event.category,
    approvalKind: event.category === "approval" ? approvalKind(event.publicPayload.kind) : null,
    itemType: event.category === "item" ? safeToken(event.publicPayload.itemType) : null,
    code:
      event.category === "error" || event.category === "warning" || event.method === "turn/completed"
        ? safeToken(event.publicPayload.code) ?? safeToken(event.publicPayload.errorCode)
        : null,
    controlAction: null,
    resultingState: null,
    processRevision: null,
    deviceAction: null,
    deviceOperationState: null,
    createdAt: event.createdAt
  };
}

export function projectOperationalActivityControlEvent(
  event: ActivityControlEventRecord,
  activityId: string
): OperationalActivityEventProjection {
  const kind: OperationalActivityEventKind =
    event.action === "pause" ? "job-paused" :
      event.action === "resume" ? "job-resumed" :
        "job-terminated";
  return {
    id: event.id,
    activityId,
    source: "job-control",
    sequence: event.sequence,
    kind,
    category: "control",
    approvalKind: null,
    itemType: null,
    code: null,
    controlAction: event.action,
    resultingState: event.resultingState,
    processRevision: event.processRevision,
    deviceAction: null,
    deviceOperationState: null,
    createdAt: event.createdAt
  };
}

export function projectDeviceRuntimeOperationEvent(
  operation: DeviceRuntimeOperationRecord
): OperationalActivityEventProjection {
  return {
    id: `${operation.id}:revision:${operation.revision}`,
    activityId: operation.id,
    source: "device-operation",
    sequence: operation.revision,
    kind: "device-operation-updated",
    category: "device-operation",
    approvalKind: null,
    itemType: null,
    code: operation.errorCode,
    controlAction: null,
    resultingState: null,
    processRevision: null,
    deviceAction: operation.action,
    deviceOperationState: operation.state,
    createdAt: operation.updatedAt
  };
}
