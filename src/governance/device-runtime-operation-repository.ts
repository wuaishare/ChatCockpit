import type { ActorType } from "../application/operation-context.js";
import { ServiceError } from "../application/service-error.js";
import type { DeviceRuntimeConditions } from "../devices/device-runtime-lifecycle.js";
import type {
  GovernanceActorProvenance,
  GovernanceStorage
} from "./governed-external-action-repository.js";

export type DeviceRuntimeOperationAction = "start" | "stop" | "restart";
export type DeviceRuntimeOperationState =
  | "prepared"
  | "awaiting-approval"
  | "executing"
  | "succeeded"
  | "failed"
  | "ambiguous"
  | "stale";
export interface DeviceRuntimeOperationRecord {
  id: string;
  deviceId: string;
  action: DeviceRuntimeOperationAction;
  state: DeviceRuntimeOperationState;
  approvalId: string;
  authorizationGrantId: string | null;
  expectedStateRevision: number | null;
  requestedActor: GovernanceActorProvenance;
  executedActor: GovernanceActorProvenance;
  preflightConditions: DeviceRuntimeConditions | null;
  postflightConditions: DeviceRuntimeConditions | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  revision: number;
}
interface OperationRow {
  id: string;
  device_id: string;
  action: DeviceRuntimeOperationAction;
  state: DeviceRuntimeOperationState;
  approval_id: string;
  authorization_grant_id: string | null;
  expected_state_revision: number | null;
  requested_actor_type: ActorType;
  requested_actor_identity_hash: string | null;
  requested_request_identity_hash: string;
  executed_actor_type: ActorType | null;
  executed_actor_identity_hash: string | null;
  executed_request_identity_hash: string | null;
  preflight_conditions_json: string | null;
  postflight_conditions_json: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  revision: number;
}
const EMPTY_ACTOR: GovernanceActorProvenance = {
  actorType: null,
  actorIdentityHash: null,
  requestIdentityHash: null
};

function parseConditions(value: string | null): DeviceRuntimeConditions | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as DeviceRuntimeConditions;
    if (
      parsed?.schemaVersion !== 1 ||
      parsed.support !== "managed-macos" ||
      typeof parsed.observedAt !== "string"
    ) throw new Error("invalid conditions");
    return parsed;
  } catch {
    throw new ServiceError(
      "GOVERNANCE_DATA_INVALID",
      "Stored device Runtime conditions are invalid"
    );
  }
}
function mapRow(row: OperationRow): DeviceRuntimeOperationRecord {
  return {
    id: row.id,
    deviceId: row.device_id,
    action: row.action,
    state: row.state,
    approvalId: row.approval_id,
    authorizationGrantId: row.authorization_grant_id,
    expectedStateRevision:
      row.expected_state_revision === null ? null : Number(row.expected_state_revision),
    requestedActor: {
      actorType: row.requested_actor_type,
      actorIdentityHash: row.requested_actor_identity_hash,
      requestIdentityHash: row.requested_request_identity_hash
    },
    executedActor: {
      actorType: row.executed_actor_type,
      actorIdentityHash: row.executed_actor_identity_hash,
      requestIdentityHash: row.executed_request_identity_hash
    },
    preflightConditions: parseConditions(row.preflight_conditions_json),
    postflightConditions: parseConditions(row.postflight_conditions_json),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    revision: Number(row.revision)
  };
}

function serializeConditions(
  value: DeviceRuntimeConditions | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 4 * 1024) {
    throw new ServiceError(
      "DEVICE_RUNTIME_OPERATION_CONDITIONS_TOO_LARGE",
      "Device Runtime conditions exceed the governance storage limit"
    );
  }
  return serialized;
}
function actorOrEmpty(
  actor: GovernanceActorProvenance | undefined
): GovernanceActorProvenance {
  return actor ?? EMPTY_ACTOR;
}

const ALLOWED_STATE_TRANSITIONS: Record<
  DeviceRuntimeOperationState,
  readonly DeviceRuntimeOperationState[]
> = {
  prepared: ["awaiting-approval", "executing", "stale"],
  "awaiting-approval": ["executing", "failed", "stale"],
  executing: ["succeeded", "failed", "ambiguous"],
  ambiguous: ["succeeded", "failed", "stale"],
  succeeded: [],
  failed: [],
  stale: []
};

function assertStateTransition(
  from: DeviceRuntimeOperationState,
  to: DeviceRuntimeOperationState
): void {
  if (ALLOWED_STATE_TRANSITIONS[from].includes(to)) return;
  throw new ServiceError(
    "DEVICE_RUNTIME_OPERATION_STATE_INVALID",
    `Device Runtime operation cannot transition from ${from} to ${to}`
  );
}

export class DeviceRuntimeOperationRepository {
  constructor(private readonly database: GovernanceStorage) {}

  create(input: {
    id: string;
    deviceId: string;
    action: DeviceRuntimeOperationAction;
    state: Extract<DeviceRuntimeOperationState, "prepared" | "awaiting-approval">;
    approvalId: string;
    authorizationGrantId?: string | null;
    expectedStateRevision?: number | null;
    requestedActorType: ActorType;
    requestedActorIdentityHash?: string | null;
    requestedRequestIdentityHash: string;
    preflightConditions?: DeviceRuntimeConditions | null;
    now?: string;
  }): DeviceRuntimeOperationRecord {
    const now = input.now ?? new Date().toISOString();
    this.database.sqlite.prepare(`
      INSERT INTO device_runtime_operations (
        id, device_id, action, state, approval_id, authorization_grant_id,
        expected_state_revision, requested_actor_type,
        requested_actor_identity_hash, requested_request_identity_hash,
        executed_actor_type, executed_actor_identity_hash,
        executed_request_identity_hash, preflight_conditions_json,
        postflight_conditions_json, error_code, created_at, updated_at,
        started_at, completed_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, NULL, NULL, 1)
    `).run(
      input.id,
      input.deviceId,
      input.action,
      input.state,
      input.approvalId,
      input.authorizationGrantId ?? null,
      input.expectedStateRevision ?? null,
      input.requestedActorType,
      input.requestedActorIdentityHash ?? null,
      input.requestedRequestIdentityHash,
      serializeConditions(input.preflightConditions) ?? null,
      now,
      now
    );
    return this.get(input.id);
  }
  get(id: string): DeviceRuntimeOperationRecord {
    const row = this.database.sqlite.prepare(`
      SELECT * FROM device_runtime_operations WHERE id = ?
    `).get(id) as OperationRow | undefined;
    if (!row) {
      throw new ServiceError(
        "DEVICE_RUNTIME_OPERATION_NOT_FOUND",
        "Device Runtime operation was not found"
      );
    }
    return mapRow(row);
  }

  find(id: string): DeviceRuntimeOperationRecord | null {
    const row = this.database.sqlite.prepare(`
      SELECT * FROM device_runtime_operations WHERE id = ?
    `).get(id) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByApprovalId(approvalId: string): DeviceRuntimeOperationRecord | null {
    const row = this.database.sqlite.prepare(`
      SELECT * FROM device_runtime_operations WHERE approval_id = ?
    `).get(approvalId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  }

  listRecent(limit = 200): DeviceRuntimeOperationRecord[] {
    const boundedLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = this.database.sqlite.prepare(`
      SELECT * FROM device_runtime_operations
      ORDER BY updated_at DESC, id ASC
      LIMIT ?
    `).all(boundedLimit) as unknown as OperationRow[];
    return rows.map(mapRow);
  }

  transition(input: {
    id: string;
    expectedRevision: number;
    to: DeviceRuntimeOperationState;
    executedActor?: GovernanceActorProvenance;
    preflightConditions?: DeviceRuntimeConditions | null;
    postflightConditions?: DeviceRuntimeConditions | null;
    errorCode?: string | null;
    now?: string;
  }): DeviceRuntimeOperationRecord {
    const current = this.get(input.id);
    if (current.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Device Runtime operation ${input.id} no longer has revision ${input.expectedRevision}`
      );
    }
    assertStateTransition(current.state, input.to);
    const now = input.now ?? new Date().toISOString();
    const actor = input.executedActor;
    const preflight = serializeConditions(input.preflightConditions);
    const postflight = serializeConditions(input.postflightConditions);
    const startedAt = input.to === "executing" ? now : current.startedAt;
    const completedAt = ["succeeded", "failed", "stale"].includes(input.to)
      ? now
      : current.completedAt;
    const result = this.database.sqlite.prepare(`
      UPDATE device_runtime_operations
      SET state = ?,
          executed_actor_type = ?,
          executed_actor_identity_hash = ?,
          executed_request_identity_hash = ?,
          preflight_conditions_json = ?,
          postflight_conditions_json = ?,
          error_code = ?, updated_at = ?, started_at = ?, completed_at = ?,
          revision = revision + 1
      WHERE id = ? AND revision = ? AND state = ?
    `).run(
      input.to,
      actor?.actorType ?? current.executedActor.actorType,
      actor?.actorIdentityHash ?? current.executedActor.actorIdentityHash,
      actor?.requestIdentityHash ?? current.executedActor.requestIdentityHash,
      preflight === undefined
        ? serializeConditions(current.preflightConditions) ?? null
        : preflight,
      postflight === undefined
        ? serializeConditions(current.postflightConditions) ?? null
        : postflight,
      input.errorCode === undefined ? current.errorCode : input.errorCode,
      now,
      startedAt,
      completedAt,
      input.id,
      input.expectedRevision,
      current.state
    );
    if (Number(result.changes) !== 1) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        "Device Runtime operation changed before the state transition completed"
      );
    }
    return this.get(input.id);
  }
}
