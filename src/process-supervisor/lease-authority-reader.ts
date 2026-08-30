import { DatabaseSync } from "node:sqlite";

import type { SupervisorOwnedProcess } from "./service.js";

export type ProcessSupervisorAuthorityFailureCode =
  | "PROCESS_RECORD_MISSING"
  | "PROCESS_NOT_ACTIVE"
  | "PROCESS_IDENTITY_MISMATCH"
  | "WRITER_LEASE_MISSING"
  | "WRITER_LEASE_INACTIVE"
  | "WRITER_LEASE_EXPIRED"
  | "SESSION_MISSING"
  | "SESSION_IDENTITY_MISMATCH"
  | "SESSION_TERMINAL"
  | "WORKSPACE_MISSING"
  | "WORKSPACE_UNAVAILABLE"
  | "HOST_AUTHORITY_MISSING"
  | "HOST_AUTHORITY_INACTIVE"
  | "HOST_AUTHORITY_EXPIRED"
  | "AUTHORITY_DB_UNAVAILABLE";

export type ProcessSupervisorAuthorityCheck =
  | { valid: true; reasonCode: null }
  | { valid: false; reasonCode: ProcessSupervisorAuthorityFailureCode };

interface WorkspaceAuthorityRow {
  process_scope: string;
  process_workspace_id: string | null;
  process_session_id: string | null;
  process_writer_lease_id: string | null;
  process_status: string;
  session_id: string | null;
  session_task_id: string | null;
  session_workspace_id: string | null;
  session_status: string | null;
  lease_id: string | null;
  lease_workspace_id: string | null;
  lease_session_id: string | null;
  lease_holder_type: string | null;
  lease_holder_id: string | null;
  lease_status: string | null;
  lease_expires_at: string | null;
  workspace_id: string | null;
  workspace_status: string | null;
}

interface HostAuthorityRow {
  process_scope: string;
  process_host_authority_id: string | null;
  process_status: string;
  authority_id: string | null;
  authority_status: string | null;
  authority_expires_at: string | null;
}

export class ProcessSupervisorLeaseAuthorityReader {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath, {
      readOnly: true,
      enableForeignKeyConstraints: true
    });
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  check(
    process: SupervisorOwnedProcess,
    now = new Date().toISOString()
  ): ProcessSupervisorAuthorityCheck {
    try {
      return process.scope === "host"
        ? this.checkHost(process, now)
        : this.checkWorkspace(process, now);
    } catch {
      return { valid: false, reasonCode: "AUTHORITY_DB_UNAVAILABLE" };
    }
  }

  private checkHost(
    process: Extract<SupervisorOwnedProcess, { scope: "host" }>,
    now: string
  ): ProcessSupervisorAuthorityCheck {
    const row = this.database
      .prepare(`
        SELECT
          p.scope AS process_scope,
          p.host_authority_id AS process_host_authority_id,
          p.status AS process_status,
          a.id AS authority_id,
          a.status AS authority_status,
          a.expires_at AS authority_expires_at
        FROM direct_process_sessions p
        LEFT JOIN host_process_authorities a ON a.id = p.host_authority_id
        WHERE p.id = ?
      `)
      .get(process.processId) as HostAuthorityRow | undefined;

    if (!row) {
      return { valid: false, reasonCode: "PROCESS_RECORD_MISSING" };
    }
    if (!new Set(["starting", "running"]).has(row.process_status)) {
      return { valid: false, reasonCode: "PROCESS_NOT_ACTIVE" };
    }
    if (
      row.process_scope !== "host" ||
      row.process_host_authority_id !== process.hostAuthorityId
    ) {
      return { valid: false, reasonCode: "PROCESS_IDENTITY_MISMATCH" };
    }
    if (!row.authority_id || row.authority_id !== process.hostAuthorityId) {
      return { valid: false, reasonCode: "HOST_AUTHORITY_MISSING" };
    }
    if (row.authority_status !== "active") {
      return { valid: false, reasonCode: "HOST_AUTHORITY_INACTIVE" };
    }
    if (!row.authority_expires_at || row.authority_expires_at <= now) {
      return { valid: false, reasonCode: "HOST_AUTHORITY_EXPIRED" };
    }
    return { valid: true, reasonCode: null };
  }

  private checkWorkspace(
    process: Extract<SupervisorOwnedProcess, { scope: "workspace" }>,
    now: string
  ): ProcessSupervisorAuthorityCheck {
    const row = this.database
      .prepare(`
        SELECT
          p.scope AS process_scope,
          p.workspace_id AS process_workspace_id,
          p.session_id AS process_session_id,
          p.writer_lease_id AS process_writer_lease_id,
          p.status AS process_status,
          s.id AS session_id,
          s.task_id AS session_task_id,
          s.workspace_id AS session_workspace_id,
          s.status AS session_status,
          l.id AS lease_id,
          l.workspace_id AS lease_workspace_id,
          l.session_id AS lease_session_id,
          l.holder_type AS lease_holder_type,
          l.holder_id AS lease_holder_id,
          l.status AS lease_status,
          l.expires_at AS lease_expires_at,
          w.id AS workspace_id,
          w.status AS workspace_status
        FROM direct_process_sessions p
        LEFT JOIN development_sessions s ON s.id = p.session_id
        LEFT JOIN writer_leases l ON l.id = p.writer_lease_id
        LEFT JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = ?
      `)
      .get(process.processId) as WorkspaceAuthorityRow | undefined;

    if (!row) {
      return { valid: false, reasonCode: "PROCESS_RECORD_MISSING" };
    }
    if (!new Set(["starting", "running"]).has(row.process_status)) {
      return { valid: false, reasonCode: "PROCESS_NOT_ACTIVE" };
    }
    if (
      row.process_scope !== "workspace" ||
      row.process_workspace_id !== process.workspaceId ||
      row.process_session_id !== process.sessionId ||
      row.process_writer_lease_id !== process.writerLeaseId
    ) {
      return { valid: false, reasonCode: "PROCESS_IDENTITY_MISMATCH" };
    }
    if (!row.session_id) {
      return { valid: false, reasonCode: "SESSION_MISSING" };
    }
    if (
      row.session_id !== process.sessionId ||
      row.session_task_id !== process.taskId ||
      row.session_workspace_id !== process.workspaceId
    ) {
      return { valid: false, reasonCode: "SESSION_IDENTITY_MISMATCH" };
    }
    if (row.session_status === "completed" || row.session_status === "failed") {
      return { valid: false, reasonCode: "SESSION_TERMINAL" };
    }
    if (!row.lease_id) {
      return { valid: false, reasonCode: "WRITER_LEASE_MISSING" };
    }
    if (
      row.lease_id !== process.writerLeaseId ||
      row.lease_workspace_id !== process.workspaceId ||
      row.lease_session_id !== process.sessionId ||
      row.lease_holder_type !== "chat-direct" ||
      row.lease_holder_id !== process.sessionId
    ) {
      return { valid: false, reasonCode: "PROCESS_IDENTITY_MISMATCH" };
    }
    if (row.lease_status !== "active") {
      return { valid: false, reasonCode: "WRITER_LEASE_INACTIVE" };
    }
    if (!row.lease_expires_at || row.lease_expires_at <= now) {
      return { valid: false, reasonCode: "WRITER_LEASE_EXPIRED" };
    }
    if (!row.workspace_id) {
      return { valid: false, reasonCode: "WORKSPACE_MISSING" };
    }
    if (row.workspace_status !== "ready") {
      return { valid: false, reasonCode: "WORKSPACE_UNAVAILABLE" };
    }
    return { valid: true, reasonCode: null };
  }

  close(): void {
    this.database.close();
  }
}
