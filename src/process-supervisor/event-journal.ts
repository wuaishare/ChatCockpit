import { randomUUID } from "node:crypto";
import fs from "node:fs";

import type { TokenPilotPaths } from "../types.js";
import { ensureProcessSupervisorRuntime } from "./runtime-files.js";

const MAX_EVENT_JOURNAL_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_COUNT = 2_000;

export type SupervisorTerminalEventKind =
  | "natural-exit"
  | "lease-revoked"
  | "runtime-failure"
  | "explicit-stop";

export type SupervisorTerminalEventStatus =
  | "exited"
  | "terminated"
  | "failed"
  | "unknown";

export interface SupervisorTerminalEvent {
  eventId: string;
  supervisorGeneration: string;
  processId: string;
  kind: SupervisorTerminalEventKind;
  status: SupervisorTerminalEventStatus;
  exitCode: number | null;
  reasonCode: string;
  occurredAt: string;
}

export class ProcessSupervisorEventJournal {
  constructor(private readonly paths: TokenPilotPaths) {}

  append(input: Omit<SupervisorTerminalEvent, "eventId"> & { eventId?: string }): SupervisorTerminalEvent {
    ensureProcessSupervisorRuntime(this.paths);
    const event: SupervisorTerminalEvent = {
      eventId: input.eventId ?? `supervisor_event_${randomUUID()}`,
      supervisorGeneration: input.supervisorGeneration,
      processId: input.processId,
      kind: input.kind,
      status: input.status,
      exitCode: input.exitCode,
      reasonCode: input.reasonCode,
      occurredAt: input.occurredAt
    };
    this.assertEvent(event);
    const line = `${JSON.stringify(event)}\n`;
    const currentBytes = fs.existsSync(this.paths.processSupervisorEventsPath)
      ? fs.statSync(this.paths.processSupervisorEventsPath).size
      : 0;
    if (currentBytes + Buffer.byteLength(line, "utf8") > MAX_EVENT_JOURNAL_BYTES) {
      throw new Error("Process Supervisor event journal exceeded its bounded size");
    }
    if (this.list().length >= MAX_EVENT_COUNT) {
      throw new Error("Process Supervisor event journal exceeded its bounded event count");
    }
    fs.appendFileSync(this.paths.processSupervisorEventsPath, line, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(this.paths.processSupervisorEventsPath, 0o600);
    return event;
  }

  list(): SupervisorTerminalEvent[] {
    if (!fs.existsSync(this.paths.processSupervisorEventsPath)) {
      return [];
    }
    const stat = fs.statSync(this.paths.processSupervisorEventsPath);
    if (stat.size > MAX_EVENT_JOURNAL_BYTES) {
      throw new Error("Process Supervisor event journal exceeded its bounded size");
    }
    const raw = fs.readFileSync(this.paths.processSupervisorEventsPath, "utf8");
    const events = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line) as SupervisorTerminalEvent;
        this.assertEvent(event);
        return event;
      });
    if (events.length > MAX_EVENT_COUNT) {
      throw new Error("Process Supervisor event journal exceeded its bounded event count");
    }
    return events;
  }

  ack(eventIds: string[]): number {
    if (eventIds.length === 0) {
      return 0;
    }
    const ids = new Set(eventIds);
    const events = this.list();
    const remaining = events.filter((event) => !ids.has(event.eventId));
    const removed = events.length - remaining.length;
    if (removed === 0) {
      return 0;
    }
    ensureProcessSupervisorRuntime(this.paths);
    const tempPath = `${this.paths.processSupervisorEventsPath}.tmp-${process.pid}`;
    const content = remaining.length > 0
      ? `${remaining.map((event) => JSON.stringify(event)).join("\n")}\n`
      : "";
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, this.paths.processSupervisorEventsPath);
    fs.chmodSync(this.paths.processSupervisorEventsPath, 0o600);
    return removed;
  }

  private assertEvent(event: SupervisorTerminalEvent): void {
    if (!event.eventId || !event.supervisorGeneration || !event.processId) {
      throw new Error("Process Supervisor event journal contains invalid identity");
    }
    if (
      !["natural-exit", "lease-revoked", "runtime-failure", "explicit-stop"].includes(
        event.kind
      )
    ) {
      throw new Error("Process Supervisor event journal contains invalid kind");
    }
    if (!["exited", "terminated", "failed", "unknown"].includes(event.status)) {
      throw new Error("Process Supervisor event journal contains invalid status");
    }
    if (!event.reasonCode || !event.occurredAt) {
      throw new Error("Process Supervisor event journal contains incomplete metadata");
    }
  }
}
