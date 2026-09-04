import { readRepoFile, readRepoFiles } from "../core/files-api.js";
import {
  editRepoFile,
  listRepoDirectory,
  mutateRepoFile,
  writeRepoFile
} from "../core/files-write.js";
import type {
  FileEditPayload,
  FileMutatePayload,
  FileListPayload,
  FileReadBatchPayload,
  FileReadPayload,
  FileWritePayload,
  TokenPilotPaths
} from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { wrapServiceOperationError } from "./service-error.js";

const DEFAULT_FILE_OPERATION_HINT =
  "Check repoId, relative path, file type, and workspace policy before retrying.";

function runFileOperation<T>(
  code: string,
  message: string,
  operation: () => T,
  hintForError?: (error: unknown) => string | null
): T {
  try {
    return operation();
  } catch (error) {
    throw wrapServiceOperationError(
      code,
      error,
      message,
      hintForError?.(error) ?? DEFAULT_FILE_OPERATION_HINT
    );
  }
}

function safeFileEditHint(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (
    error.message === "search text must not be empty" ||
    error.message.startsWith("search text not found in ") ||
    error.message.startsWith("search text is not unique in ")
  ) {
    return error.message;
  }
  return null;
}

export class FilesService {
  constructor(private readonly paths: TokenPilotPaths) {}

  read(_context: OperationContext, payload: FileReadPayload) {
    return runFileOperation(
      "FILES_READ_BLOCKED",
      "File read was blocked or could not be completed.",
      () => readRepoFile(this.paths, payload)
    );
  }

  readBatch(_context: OperationContext, payload: FileReadBatchPayload) {
    return runFileOperation(
      "FILES_READ_BLOCKED",
      "File read was blocked or could not be completed.",
      () => readRepoFiles(this.paths, payload)
    );
  }

  write(_context: OperationContext, payload: FileWritePayload) {
    return runFileOperation(
      "FILES_WRITE_BLOCKED",
      "File write was blocked or could not be completed.",
      () => writeRepoFile(this.paths, payload)
    );
  }

  edit(_context: OperationContext, payload: FileEditPayload) {
    return runFileOperation(
      "FILES_EDIT_BLOCKED",
      "File edit was blocked or could not be completed.",
      () => editRepoFile(this.paths, payload),
      safeFileEditHint
    );
  }

  mutate(_context: OperationContext, payload: FileMutatePayload) {
    return runFileOperation(
      "FILES_MUTATE_BLOCKED",
      "File mutation was blocked or could not be completed.",
      () => mutateRepoFile(this.paths, payload)
    );
  }

  list(_context: OperationContext, payload: FileListPayload) {
    return runFileOperation(
      "FILES_LIST_BLOCKED",
      "Directory listing was blocked or could not be completed.",
      () => listRepoDirectory(this.paths, payload)
    );
  }
}
