import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeResourceAuthStatus,
  RuntimeResourceCompatibilityStatus,
  RuntimeResourceItemRecord,
  RuntimeResourceKind,
  RuntimeResourceScope,
  RuntimeResourceSnapshotRecord,
  RuntimeResourceSnapshotStatus,
  RuntimeResourceSourceKind,
  RuntimeResourceUpdateStatus
} from "../types.js";
import { newRecordId, nowIso, requireRecord } from "./repository-utils.js";

const MAX_RESOURCE_ITEMS_PER_SNAPSHOT = 1000;

interface RuntimeResourceSnapshotRow {
  id: string;
  runtime_profile_id: string;
  provider_kind: string;
  protocol_kind: string;
  status: RuntimeResourceSnapshotStatus;
  profile_json: string;
  fingerprint: string;
  captured_at: string;
  revision: number;
}

interface RuntimeResourceItemRow {
  snapshot_id: string;
  resource_id: string;
  kind: RuntimeResourceKind;
  external_id: string;
  display_name: string;
  description: string | null;
  scope: RuntimeResourceScope;
  installed: number | null;
  enabled: number | null;
  version: string | null;
  available_version: string | null;
  update_status: RuntimeResourceUpdateStatus;
  auth_status: RuntimeResourceAuthStatus;
  compatibility_status: RuntimeResourceCompatibilityStatus;
  source_kind: RuntimeResourceSourceKind;
  source_label: string;
  capabilities_json: string;
  public_reason: string | null;
  fingerprint: string;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      `Stored Runtime Resource ${label} is invalid`
    );
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("expected string array");
    }
    return parsed;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Runtime Resource capabilities are invalid"
    );
  }
}

function itemFromRow(row: RuntimeResourceItemRow): RuntimeResourceItemRecord {
  return {
    snapshotId: row.snapshot_id,
    resourceId: row.resource_id,
    kind: row.kind,
    externalId: row.external_id,
    displayName: row.display_name,
    description: row.description,
    scope: row.scope,
    installed: row.installed === null ? null : row.installed === 1,
    enabled: row.enabled === null ? null : row.enabled === 1,
    version: row.version,
    availableVersion: row.available_version,
    updateStatus: row.update_status,
    authStatus: row.auth_status,
    compatibilityStatus: row.compatibility_status,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    capabilities: parseStringArray(row.capabilities_json),
    publicReason: row.public_reason,
    fingerprint: row.fingerprint
  };
}

function snapshotFromRow(
  row: RuntimeResourceSnapshotRow,
  items: RuntimeResourceItemRecord[]
): RuntimeResourceSnapshotRecord {
  return {
    id: row.id,
    runtimeProfileId: row.runtime_profile_id,
    providerKind: row.provider_kind,
    protocolKind: row.protocol_kind,
    status: row.status,
    profile: parseObject(row.profile_json, "profile"),
    fingerprint: row.fingerprint,
    capturedAt: row.captured_at,
    revision: Number(row.revision),
    items
  };
}

export interface CreateRuntimeResourceSnapshotItemInput {
  resourceId: string;
  kind: RuntimeResourceKind;
  externalId: string;
  displayName: string;
  description?: string | null;
  scope: RuntimeResourceScope;
  installed: boolean | null;
  enabled: boolean | null;
  version?: string | null;
  availableVersion?: string | null;
  updateStatus: RuntimeResourceUpdateStatus;
  authStatus: RuntimeResourceAuthStatus;
  compatibilityStatus: RuntimeResourceCompatibilityStatus;
  sourceKind: RuntimeResourceSourceKind;
  sourceLabel: string;
  capabilities: string[];
  publicReason?: string | null;
  fingerprint: string;
}

export interface CreateRuntimeResourceSnapshotInput {
  id?: string;
  runtimeProfileId: string;
  providerKind: string;
  protocolKind: string;
  status: RuntimeResourceSnapshotStatus;
  profile: Record<string, unknown>;
  fingerprint: string;
  items: CreateRuntimeResourceSnapshotItemInput[];
  now?: string;
}

export class RuntimeResourceSnapshotRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateRuntimeResourceSnapshotInput): RuntimeResourceSnapshotRecord {
    if (input.items.length > MAX_RESOURCE_ITEMS_PER_SNAPSHOT) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_LIMIT_EXCEEDED",
        `Runtime Resource snapshot exceeds ${MAX_RESOURCE_ITEMS_PER_SNAPSHOT} items`
      );
    }
    if (new Set(input.items.map((item) => item.resourceId)).size !== input.items.length) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_DUPLICATE",
        "Runtime Resource snapshot contains duplicate resource IDs"
      );
    }

    const id = input.id ?? newRecordId("resource_snapshot");
    const now = nowIso(input.now);
    this.database.transaction(() => {
      this.database.sqlite
        .prepare(`
          INSERT INTO runtime_resource_snapshots (
            id, runtime_profile_id, provider_kind, protocol_kind, status,
            profile_json, fingerprint, captured_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `)
        .run(
          id,
          input.runtimeProfileId,
          input.providerKind,
          input.protocolKind,
          input.status,
          JSON.stringify(input.profile),
          input.fingerprint,
          now
        );

      const statement = this.database.sqlite.prepare(`
        INSERT INTO runtime_resource_items (
          snapshot_id, resource_id, kind, external_id, display_name, description,
          scope, installed, enabled, version, available_version, update_status,
          auth_status, compatibility_status, source_kind, source_label,
          capabilities_json, public_reason, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of input.items) {
        statement.run(
          id,
          item.resourceId,
          item.kind,
          item.externalId,
          item.displayName,
          item.description ?? null,
          item.scope,
          item.installed === null ? null : item.installed ? 1 : 0,
          item.enabled === null ? null : item.enabled ? 1 : 0,
          item.version ?? null,
          item.availableVersion ?? null,
          item.updateStatus,
          item.authStatus,
          item.compatibilityStatus,
          item.sourceKind,
          item.sourceLabel,
          JSON.stringify([...item.capabilities].sort()),
          item.publicReason ?? null,
          item.fingerprint
        );
      }
    });
    return this.get(id);
  }

  get(id: string): RuntimeResourceSnapshotRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_resource_snapshots WHERE id = ?")
      .get(id) as RuntimeResourceSnapshotRow | undefined;
    const snapshot = requireRecord(row, "Runtime resource snapshot", id);
    return snapshotFromRow(snapshot, this.itemsForSnapshot(id));
  }

  latestForProfile(runtimeProfileId: string): RuntimeResourceSnapshotRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_resource_snapshots
        WHERE runtime_profile_id = ?
        ORDER BY captured_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(runtimeProfileId) as RuntimeResourceSnapshotRow | undefined;
    return row ? snapshotFromRow(row, this.itemsForSnapshot(row.id)) : null;
  }

  latestItem(resourceId: string): RuntimeResourceItemRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT item.*
        FROM runtime_resource_items AS item
        JOIN runtime_resource_snapshots AS snapshot
          ON snapshot.id = item.snapshot_id
        WHERE item.resource_id = ?
        ORDER BY snapshot.captured_at DESC, snapshot.rowid DESC
        LIMIT 1
      `)
      .get(resourceId) as RuntimeResourceItemRow | undefined;
    return row ? itemFromRow(row) : null;
  }

  list(input: { runtimeProfileId?: string; limit?: number } = {}): RuntimeResourceSnapshotRecord[] {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = input.runtimeProfileId
      ? (this.database.sqlite
          .prepare(`
            SELECT * FROM runtime_resource_snapshots
            WHERE runtime_profile_id = ?
            ORDER BY captured_at DESC, rowid DESC
            LIMIT ?
          `)
          .all(input.runtimeProfileId, limit) as unknown as RuntimeResourceSnapshotRow[])
      : (this.database.sqlite
          .prepare(`
            SELECT * FROM runtime_resource_snapshots
            ORDER BY captured_at DESC, rowid DESC
            LIMIT ?
          `)
          .all(limit) as unknown as RuntimeResourceSnapshotRow[]);
    return rows.map((row) => snapshotFromRow(row, this.itemsForSnapshot(row.id)));
  }

  private itemsForSnapshot(snapshotId: string): RuntimeResourceItemRecord[] {
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_resource_items
        WHERE snapshot_id = ?
        ORDER BY kind ASC, display_name COLLATE NOCASE ASC, resource_id ASC
      `)
      .all(snapshotId) as unknown as RuntimeResourceItemRow[];
    return rows.map(itemFromRow);
  }
}
