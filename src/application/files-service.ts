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
import { ServiceError } from "./service-error.js";

function runFileOperation<T>(code: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new ServiceError(
      code,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export class FilesService {
  constructor(private readonly paths: TokenPilotPaths) {}

  read(_context: OperationContext, payload: FileReadPayload) {
    return runFileOperation("FILES_READ_BLOCKED", () =>
      readRepoFile(this.paths, payload)
    );
  }

  readBatch(_context: OperationContext, payload: FileReadBatchPayload) {
    return runFileOperation("FILES_READ_BLOCKED", () =>
      readRepoFiles(this.paths, payload)
    );
  }

  write(_context: OperationContext, payload: FileWritePayload) {
    return runFileOperation("FILES_WRITE_BLOCKED", () =>
      writeRepoFile(this.paths, payload)
    );
  }

  edit(_context: OperationContext, payload: FileEditPayload) {
    return runFileOperation("FILES_EDIT_BLOCKED", () =>
      editRepoFile(this.paths, payload)
    );
  }

  list(_context: OperationContext, payload: FileListPayload) {
    return runFileOperation("FILES_LIST_BLOCKED", () =>
      listRepoDirectory(this.paths, payload)
    );
  }
}
