import type { ContinuityDatabase } from "../database.js";
import type {
  EvidenceBundleRecord,
  EvidenceItemRecord,
  EvidenceKind,
  EvidenceStatus
} from "../types.js";
import {
  assertUpdated,
  booleanFromSql,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface EvidenceBundleRow {
  id: string;
  task_id: string;
  session_id: string;
  status: "collecting" | "complete" | "incomplete";
  required_item_count: number;
  passed_item_count: number;
  failed_item_count: number;
  skipped_item_count: number;
  created_at: string;
  completed_at: string | null;
  revision: number;
}

interface EvidenceItemRow {
  id: string;
  bundle_id: string;
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  required: number;
  command: string | null;
  exit_code: number | null;
  artifact_id: string | null;
  summary: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function bundleFromRow(row: EvidenceBundleRow): EvidenceBundleRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    status: row.status,
    requiredItemCount: Number(row.required_item_count),
    passedItemCount: Number(row.passed_item_count),
    failedItemCount: Number(row.failed_item_count),
    skippedItemCount: Number(row.skipped_item_count),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    revision: Number(row.revision)
  };
}

function itemFromRow(row: EvidenceItemRow): EvidenceItemRecord {
  return {
    id: row.id,
    bundleId: row.bundle_id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    required: booleanFromSql(row.required),
    command: row.command,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    artifactId: row.artifact_id,
    summary: row.summary,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export interface CreateEvidenceBundleInput {
  id?: string;
  taskId: string;
  sessionId: string;
  now?: string;
}

export interface AddEvidenceItemInput {
  id?: string;
  bundleId: string;
  kind: EvidenceKind;
  label: string;
  status?: EvidenceStatus;
  required?: boolean;
  command?: string | null;
  exitCode?: number | null;
  artifactId?: string | null;
  summary?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  now?: string;
}

export class EvidenceRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  createBundle(input: CreateEvidenceBundleInput): EvidenceBundleRecord {
    const id = input.id ?? newRecordId("evidence");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO evidence_bundles (
          id, task_id, session_id, status, required_item_count,
          passed_item_count, failed_item_count, skipped_item_count,
          created_at, completed_at, revision
        ) VALUES (?, ?, ?, 'collecting', 0, 0, 0, 0, ?, NULL, 1)
      `)
      .run(id, input.taskId, input.sessionId, now);
    return this.getBundle(id);
  }

  getBundle(id: string): EvidenceBundleRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM evidence_bundles WHERE id = ?")
      .get(id) as EvidenceBundleRow | undefined;
    return bundleFromRow(requireRecord(row, "Evidence bundle", id));
  }

  listItems(bundleId: string): EvidenceItemRecord[] {
    const rows = this.database.sqlite
      .prepare("SELECT * FROM evidence_items WHERE bundle_id = ? ORDER BY created_at ASC")
      .all(bundleId) as unknown as EvidenceItemRow[];
    return rows.map(itemFromRow);
  }

  addItem(input: AddEvidenceItemInput): EvidenceItemRecord {
    return this.database.transaction(() => {
      this.getBundle(input.bundleId);
      const id = input.id ?? newRecordId("evidence_item");
      const now = nowIso(input.now);
      this.database.sqlite
        .prepare(`
          INSERT INTO evidence_items (
            id, bundle_id, kind, label, status, required, command,
            exit_code, artifact_id, summary, started_at, completed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.bundleId,
          input.kind,
          input.label,
          input.status ?? "not-run",
          input.required ? 1 : 0,
          input.command ?? null,
          input.exitCode ?? null,
          input.artifactId ?? null,
          input.summary ?? "",
          input.startedAt ?? null,
          input.completedAt ?? null,
          now
        );
      this.refreshCounts(input.bundleId);
      const row = this.database.sqlite
        .prepare("SELECT * FROM evidence_items WHERE id = ?")
        .get(id) as EvidenceItemRow | undefined;
      return itemFromRow(requireRecord(row, "Evidence item", id));
    });
  }

  finalize(
    id: string,
    expectedRevision: number,
    completedAt?: string
  ): EvidenceBundleRecord {
    return this.database.transaction(() => {
      const bundle = this.getBundle(id);
      if (bundle.revision !== expectedRevision) {
        assertUpdated(0, "Evidence bundle", id, expectedRevision);
      }
      const required = this.database.sqlite
        .prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status = 'not-run' THEN 1 ELSE 0 END) AS not_run
          FROM evidence_items
          WHERE bundle_id = ? AND required = 1
        `)
        .get(id) as {
          total: number;
          passed: number | null;
          failed: number | null;
          skipped: number | null;
          not_run: number | null;
        };
      const complete =
        Number(required.total) === Number(required.passed ?? 0) &&
        Number(required.failed ?? 0) === 0 &&
        Number(required.skipped ?? 0) === 0 &&
        Number(required.not_run ?? 0) === 0;
      const result = this.database.sqlite
        .prepare(`
          UPDATE evidence_bundles
          SET status = ?, completed_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ?
        `)
        .run(
          complete ? "complete" : "incomplete",
          nowIso(completedAt),
          id,
          expectedRevision
        );
      assertUpdated(result.changes, "Evidence bundle", id, expectedRevision);
      return this.getBundle(id);
    });
  }

  private refreshCounts(bundleId: string): void {
    const counts = this.database.sqlite
      .prepare(`
        SELECT
          SUM(CASE WHEN required = 1 THEN 1 ELSE 0 END) AS required_count,
          SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
        FROM evidence_items
        WHERE bundle_id = ?
      `)
      .get(bundleId) as {
        required_count: number | null;
        passed_count: number | null;
        failed_count: number | null;
        skipped_count: number | null;
      };
    this.database.sqlite
      .prepare(`
        UPDATE evidence_bundles
        SET required_item_count = ?, passed_item_count = ?,
            failed_item_count = ?, skipped_item_count = ?,
            revision = revision + 1
        WHERE id = ?
      `)
      .run(
        Number(counts.required_count ?? 0),
        Number(counts.passed_count ?? 0),
        Number(counts.failed_count ?? 0),
        Number(counts.skipped_count ?? 0),
        bundleId
      );
  }
}
