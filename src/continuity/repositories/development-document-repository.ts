import { createHash } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  DevelopmentDocumentKind,
  DevelopmentDocumentRecord,
  DevelopmentDocumentStatus,
  DevelopmentDocumentVersionRecord
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DevelopmentDocumentRow {
  id: string;
  project_id: string;
  workspace_id: string;
  kind: DevelopmentDocumentKind;
  title: string;
  status: DevelopmentDocumentStatus;
  current_version: number;
  created_at: string;
  updated_at: string;
  revision: number;
}

interface DevelopmentDocumentVersionRow {
  id: string;
  document_id: string;
  version: number;
  content_markdown: string;
  content_hash: string;
  change_summary: string;
  created_at: string;
}

function documentFromRow(row: DevelopmentDocumentRow): DevelopmentDocumentRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    currentVersion: Number(row.current_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

function versionFromRow(
  row: DevelopmentDocumentVersionRow
): DevelopmentDocumentVersionRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    version: Number(row.version),
    contentMarkdown: row.content_markdown,
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    createdAt: row.created_at
  };
}

function contentHash(contentMarkdown: string): string {
  return createHash("sha256").update(contentMarkdown, "utf8").digest("hex");
}

function requireContent(contentMarkdown: string): string {
  if (!contentMarkdown.trim()) {
    throw new ServiceError(
      "DEVELOPMENT_DOCUMENT_CONTENT_REQUIRED",
      "Spec and Plan versions require non-empty Markdown content."
    );
  }
  return contentMarkdown;
}

const allowedStatusTransitions: Readonly<
  Record<DevelopmentDocumentStatus, readonly DevelopmentDocumentStatus[]>
> = {
  draft: ["ready", "archived"],
  ready: ["draft", "approved", "archived"],
  approved: ["superseded", "archived"],
  superseded: ["archived"],
  archived: []
};

export interface CreateDevelopmentDocumentInput {
  id?: string;
  versionId?: string;
  projectId: string;
  workspaceId: string;
  kind: DevelopmentDocumentKind;
  title: string;
  contentMarkdown: string;
  changeSummary?: string;
  now?: string;
}

export interface AppendDevelopmentDocumentVersionInput {
  versionId?: string;
  contentMarkdown: string;
  changeSummary?: string;
  expectedRevision: number;
  now?: string;
}

export class DevelopmentDocumentRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(
    input: CreateDevelopmentDocumentInput
  ): {
    document: DevelopmentDocumentRecord;
    version: DevelopmentDocumentVersionRecord;
  } {
    return this.database.transaction(() => {
      const id = input.id ?? newRecordId(input.kind);
      const versionId = input.versionId ?? newRecordId(`${input.kind}_version`);
      const now = nowIso(input.now);
      const content = requireContent(input.contentMarkdown);
      this.database.sqlite
        .prepare(`
          INSERT INTO development_documents (
            id, project_id, workspace_id, kind, title, status,
            current_version, created_at, updated_at, revision
          ) VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?, 1)
        `)
        .run(
          id,
          input.projectId,
          input.workspaceId,
          input.kind,
          input.title,
          now,
          now
        );
      this.database.sqlite
        .prepare(`
          INSERT INTO development_document_versions (
            id, document_id, version, content_markdown, content_hash,
            change_summary, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?)
        `)
        .run(
          versionId,
          id,
          content,
          contentHash(content),
          input.changeSummary ?? "Initial version",
          now
        );
      return {
        document: this.get(id),
        version: this.getVersion(id, 1)
      };
    });
  }

  get(id: string): DevelopmentDocumentRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM development_documents WHERE id = ?")
      .get(id) as DevelopmentDocumentRow | undefined;
    return documentFromRow(requireRecord(row, "Development document", id));
  }

  listByWorkspace(
    workspaceId: string,
    options: {
      kind?: DevelopmentDocumentKind;
      status?: DevelopmentDocumentStatus;
    } = {}
  ): DevelopmentDocumentRecord[] {
    const conditions = ["workspace_id = ?"];
    const values: string[] = [workspaceId];
    if (options.kind) {
      conditions.push("kind = ?");
      values.push(options.kind);
    }
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM development_documents
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC, created_at ASC
      `)
      .all(...values) as unknown as DevelopmentDocumentRow[];
    return rows.map(documentFromRow);
  }

  getVersion(
    documentId: string,
    version: number
  ): DevelopmentDocumentVersionRecord {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM development_document_versions
        WHERE document_id = ? AND version = ?
      `)
      .get(documentId, version) as DevelopmentDocumentVersionRow | undefined;
    return versionFromRow(
      requireRecord(row, "Development document version", `${documentId}@${version}`)
    );
  }

  getCurrentVersion(documentId: string): DevelopmentDocumentVersionRecord {
    const document = this.get(documentId);
    return this.getVersion(document.id, document.currentVersion);
  }

  listVersions(documentId: string): DevelopmentDocumentVersionRecord[] {
    this.get(documentId);
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM development_document_versions
        WHERE document_id = ?
        ORDER BY version DESC
      `)
      .all(documentId) as unknown as DevelopmentDocumentVersionRow[];
    return rows.map(versionFromRow);
  }

  appendVersion(
    id: string,
    input: AppendDevelopmentDocumentVersionInput
  ): {
    document: DevelopmentDocumentRecord;
    version: DevelopmentDocumentVersionRecord;
  } {
    return this.database.transaction(() => {
      const document = this.get(id);
      if (document.revision !== input.expectedRevision) {
        assertUpdated(0, "Development document", id, input.expectedRevision);
      }
      if (["superseded", "archived"].includes(document.status)) {
        throw new ServiceError(
          "DEVELOPMENT_DOCUMENT_VERSION_BLOCKED",
          `Cannot append a version to a ${document.status} document.`
        );
      }
      const content = requireContent(input.contentMarkdown);
      const nextVersion = document.currentVersion + 1;
      const versionId =
        input.versionId ?? newRecordId(`${document.kind}_version`);
      const now = nowIso(input.now);
      this.database.sqlite
        .prepare(`
          INSERT INTO development_document_versions (
            id, document_id, version, content_markdown, content_hash,
            change_summary, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          versionId,
          document.id,
          nextVersion,
          content,
          contentHash(content),
          input.changeSummary ?? `Version ${nextVersion}`,
          now
        );
      const result = this.database.sqlite
        .prepare(`
          UPDATE development_documents
          SET current_version = ?, status = 'draft', updated_at = ?,
              revision = revision + 1
          WHERE id = ? AND revision = ?
        `)
        .run(nextVersion, now, id, input.expectedRevision);
      assertUpdated(
        result.changes,
        "Development document",
        id,
        input.expectedRevision
      );
      return {
        document: this.get(id),
        version: this.getVersion(id, nextVersion)
      };
    });
  }

  updateStatus(
    id: string,
    status: DevelopmentDocumentStatus,
    expectedRevision: number,
    now?: string
  ): DevelopmentDocumentRecord {
    const document = this.get(id);
    if (document.revision !== expectedRevision) {
      assertUpdated(0, "Development document", id, expectedRevision);
    }
    if (document.status === status) {
      return document;
    }
    if (!allowedStatusTransitions[document.status].includes(status)) {
      throw new ServiceError(
        "DEVELOPMENT_DOCUMENT_STATUS_INVALID",
        `Cannot move a ${document.kind} from ${document.status} to ${status}.`,
        {
          details: {
            documentId: id,
            currentStatus: document.status,
            requestedStatus: status
          }
        }
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE development_documents
        SET status = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(status, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Development document", id, expectedRevision);
    return this.get(id);
  }
}
