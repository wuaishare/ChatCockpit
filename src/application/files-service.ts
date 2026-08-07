import { readRepoFile, readRepoFiles } from "../core/files-api.js";
import { editRepoFile, listRepoDirectory, writeRepoFile } from "../core/files-write.js";
import type {
  FileEditPayload,
  FileListPayload,
  FileReadBatchPayload,
  FileReadPayload,
  FileWritePayload,
  TokenPilotPaths
} from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { wrapServiceOperationError } from "./service-error.js";

function runFileOperation<T>(
  code: string,
  message: string,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    throw wrapServiceOperationError(
      code,
      error,
      message,
      "Check repoId, relative path, file type, and workspace policy before retrying."
    );
  }
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
      () => editRepoFile(this.paths, payload)
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
