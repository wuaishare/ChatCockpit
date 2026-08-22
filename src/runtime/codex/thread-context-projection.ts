import { createHash } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";
import type { PrivateWorkspaceRecord } from "../../continuity/types.js";
import type {
  RuntimeThreadContextInput,
  RuntimeThreadContextMessage,
  RuntimeThreadContextPage
} from "./runtime-adapter.js";
import { resolveThreadWorkspace } from "./thread-projection.js";

export const MAX_THREAD_CONTEXT_MESSAGES = 40;
export const MAX_THREAD_CONTEXT_MESSAGE_BYTES = 8 * 1024;
export const MAX_THREAD_CONTEXT_PAGE_BYTES = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function threadCursorScope(threadId: string): string {
  return createHash("sha256").update(threadId).digest("hex").slice(0, 12);
}

function encodeCursor(threadId: string, offset: number): string {
  return `ctx1:${threadCursorScope(threadId)}:${offset}`;
}

function decodeCursor(threadId: string, cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const match = /^ctx1:([0-9a-f]{12}):(\d+)$/.exec(cursor);
  if (!match || match[1] !== threadCursorScope(threadId)) {
    throw new ServiceError(
      "CODEX_THREAD_CONTEXT_CURSOR_INVALID",
      "Codex thread context cursor is invalid for this thread"
    );
  }
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ServiceError(
      "CODEX_THREAD_CONTEXT_CURSOR_INVALID",
      "Codex thread context cursor offset is invalid"
    );
  }
  return offset;
}

function truncateUtf8(value: string, byteLimit: number): { text: string; truncated: boolean } {
  const source = Buffer.from(value, "utf8");
  if (source.length <= byteLimit) {
    return { text: value, truncated: false };
  }

  let end = byteLimit;
  while (end > 0 && (source[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  if (end === 0) {
    return { text: "", truncated: true };
  }
  const leading = source[end];
  const expectedLength =
    (leading & 0b1000_0000) === 0
      ? 1
      : (leading & 0b1110_0000) === 0b1100_0000
        ? 2
        : (leading & 0b1111_0000) === 0b1110_0000
          ? 3
          : (leading & 0b1111_1000) === 0b1111_0000
            ? 4
            : 1;
  if (end + expectedLength > byteLimit) {
    return { text: source.subarray(0, end).toString("utf8"), truncated: true };
  }
  return { text: source.subarray(0, byteLimit).toString("utf8"), truncated: true };
}

function visibleUserText(item: Record<string, unknown>): string | null {
  if (item.type !== "userMessage" || !Array.isArray(item.content)) return null;
  const parts = item.content
    .map(asRecord)
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => String(content.text));
  return parts.length > 0 ? parts.join("\n") : null;
}

function visibleAgentText(item: Record<string, unknown>): string | null {
  if (item.type !== "agentMessage") return null;
  if (typeof item.text === "string") {
    return item.text;
  }
  if (!Array.isArray(item.content)) return null;
  const parts = item.content
    .map(asRecord)
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => String(content.text));
  return parts.length > 0 ? parts.join("\n") : null;
}

function projectVisibleMessages(thread: Record<string, unknown>): RuntimeThreadContextMessage[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages: RuntimeThreadContextMessage[] = [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = asRecord(turns[turnIndex]);
    const turnId = stringOrNull(turn.id) ?? `turn-${turnIndex + 1}`;
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = asRecord(items[itemIndex]);
      const userText = visibleUserText(item);
      const agentText = visibleAgentText(item);
      const role = userText !== null ? "user" : agentText !== null ? "assistant" : null;
      const text = userText ?? agentText;
      if (!role || text === null) continue;

      const bounded = truncateUtf8(text, MAX_THREAD_CONTEXT_MESSAGE_BYTES);
      messages.push({
        id: stringOrNull(item.id) ?? `${turnId}:message-${itemIndex + 1}`,
        turnId,
        role,
        text: bounded.text,
        truncated: bounded.truncated
      });
    }
  }

  return messages;
}

function lastTurnId(thread: Record<string, unknown>): string | null {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const id = stringOrNull(asRecord(turns[index]).id);
    if (id) return id;
  }
  return null;
}

function pageByteLength(page: RuntimeThreadContextPage): number {
  return Buffer.byteLength(JSON.stringify(page), "utf8");
}

export function projectCodexThreadContext(
  value: unknown,
  workspaces: PrivateWorkspaceRecord[],
  input: RuntimeThreadContextInput
): RuntimeThreadContextPage {
  const thread = asRecord(value);
  const threadId = stringOrNull(thread.id);
  if (!threadId || threadId !== input.threadId) {
    throw new ServiceError(
      "CODEX_THREAD_RESPONSE_INVALID",
      "Codex App Server returned an invalid thread for context projection"
    );
  }

  const cwd = stringOrNull(thread.cwd);
  const workspace = resolveThreadWorkspace(cwd, workspaces);
  const visibleMessages = projectVisibleMessages(thread);
  const offset = decodeCursor(threadId, input.cursor);
  if (offset > visibleMessages.length) {
    throw new ServiceError(
      "CODEX_THREAD_CONTEXT_CURSOR_INVALID",
      "Codex thread context cursor is outside the visible message range"
    );
  }

  const limit = Math.max(
    1,
    Math.min(MAX_THREAD_CONTEXT_MESSAGES, Math.floor(input.limit ?? 20))
  );
  const selected: RuntimeThreadContextMessage[] = [];
  let nextOffset = offset;

  while (nextOffset < visibleMessages.length && selected.length < limit) {
    const candidateMessages = [...selected, visibleMessages[nextOffset]!];
    const candidateNextOffset = nextOffset + 1;
    const hasMore = candidateNextOffset < visibleMessages.length;
    const candidatePage: RuntimeThreadContextPage = {
      threadId,
      projectId: workspace?.projectId ?? null,
      workspaceId: workspace?.id ?? null,
      repoId: workspace?.repoId ?? null,
      messages: candidateMessages,
      nextCursor: hasMore ? encodeCursor(threadId, candidateNextOffset) : null,
      truncated:
        hasMore || candidateMessages.some((message) => message.truncated),
      lastTurnId: lastTurnId(thread)
    };
    if (pageByteLength(candidatePage) > MAX_THREAD_CONTEXT_PAGE_BYTES) {
      break;
    }
    selected.push(visibleMessages[nextOffset]!);
    nextOffset = candidateNextOffset;
  }

  const hasMore = nextOffset < visibleMessages.length;
  const page: RuntimeThreadContextPage = {
    threadId,
    projectId: workspace?.projectId ?? null,
    workspaceId: workspace?.id ?? null,
    repoId: workspace?.repoId ?? null,
    messages: selected,
    nextCursor: hasMore ? encodeCursor(threadId, nextOffset) : null,
    truncated: hasMore || selected.some((message) => message.truncated),
    lastTurnId: lastTurnId(thread)
  };

  if (pageByteLength(page) > MAX_THREAD_CONTEXT_PAGE_BYTES) {
    throw new ServiceError(
      "CODEX_THREAD_CONTEXT_TOO_LARGE",
      "Codex thread context projection exceeded the page size limit"
    );
  }
  return page;
}
