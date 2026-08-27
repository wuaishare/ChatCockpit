import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ServiceError } from "../../application/service-error.js";
import type {
  CodexAppServerClient,
  CodexAppServerInitialization
} from "./app-server-client.js";
import type { CodexBinaryResolution } from "./binary.js";
import {
  type CodexStandaloneCapabilitySnapshot,
  type CodexStandaloneOperation,
  type CodexStandaloneOperationCapability
} from "./standalone-capabilities.js";

interface ReadFileResponse {
  dataBase64?: unknown;
}

interface ReadDirectoryResponse {
  entries?: unknown;
}

interface MetadataResponse {
  isDirectory?: unknown;
  isFile?: unknown;
  isSymlink?: unknown;
  createdAtMs?: unknown;
  modifiedAtMs?: unknown;
}

interface FuzzySearchResponse {
  files?: unknown;
}

interface CommandExecResponse {
  exitCode?: unknown;
  stdout?: unknown;
  stderr?: unknown;
}

export interface CodexStandaloneProbeOptions {
  client: CodexAppServerClient;
  binary: CodexBinaryResolution;
  rootPath: string;
  now?: () => Date;
}

function errorCode(error: unknown): string {
  return error instanceof ServiceError ? error.code : "INTERNAL_ERROR";
}

function unavailableOperation(
  operation: CodexStandaloneOperation,
  errorCodeValue: string
): CodexStandaloneOperationCapability {
  return {
    operation,
    method: null,
    status: "unavailable",
    safeForChatDirect: false,
    errorCode: errorCodeValue,
    evidence: {}
  };
}

export class CodexStandaloneCapabilityProbe {
  private readonly client: CodexAppServerClient;
  private readonly binary: CodexBinaryResolution;
  private readonly rootPath: string;
  private readonly now: () => Date;
  private readonly outgoingMethods: string[] = [];

  constructor(options: CodexStandaloneProbeOptions) {
    this.client = options.client;
    this.binary = options.binary;
    this.rootPath = path.resolve(options.rootPath);
    this.now = options.now ?? (() => new Date());
  }

  async run(): Promise<CodexStandaloneCapabilitySnapshot> {
    fs.mkdirSync(this.rootPath, { recursive: true });
    const initialization = await this.client.start();
    const suffix = randomUUID().slice(0, 8);
    const sourceName = `chatcockpit-standalone-${suffix}.txt`;
    const sourcePath = path.join(this.rootPath, sourceName);
    const writtenPath = path.join(
      this.rootPath,
      `chatcockpit-standalone-written-${suffix}.txt`
    );
    const copiedPath = path.join(
      this.rootPath,
      `chatcockpit-standalone-copied-${suffix}.txt`
    );
    const createdDirectory = path.join(
      this.rootPath,
      `chatcockpit-standalone-dir-${suffix}`
    );
    const fixtureContent = `ChatCockpit standalone probe ${suffix}\n`;
    const writtenContent = `ChatCockpit App Server write ${suffix}\n`;
    fs.writeFileSync(sourcePath, fixtureContent, "utf8");

    const operations = {} as Record<
      CodexStandaloneOperation,
      CodexStandaloneOperationCapability
    >;

    try {
      operations["files.metadata"] = await this.verifyOperation(
        "files.metadata",
        "fs/getMetadata",
        true,
        async () => {
          const response = await this.request<MetadataResponse>(
            "fs/getMetadata",
            { path: this.rootPath }
          );
          if (
            response.isDirectory !== true ||
            response.isFile !== false ||
            typeof response.modifiedAtMs !== "number"
          ) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/getMetadata returned an invalid directory projection"
            );
          }
          return {
            directoryDetected: true,
            timestampReturned: true
          };
        }
      );

      operations["files.list"] = await this.verifyOperation(
        "files.list",
        "fs/readDirectory",
        true,
        async () => {
          const response = await this.request<ReadDirectoryResponse>(
            "fs/readDirectory",
            { path: this.rootPath }
          );
          if (!Array.isArray(response.entries)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/readDirectory returned no entry list"
            );
          }
          const found = response.entries.some((value) => {
            const entry =
              value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
            return entry.fileName === sourceName && entry.isFile === true;
          });
          if (!found) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/readDirectory did not return the probe file"
            );
          }
          return {
            fixtureFound: true,
            entryCount: response.entries.length
          };
        }
      );

      operations["files.read"] = await this.verifyOperation(
        "files.read",
        "fs/readFile",
        true,
        async () => {
          const response = await this.request<ReadFileResponse>("fs/readFile", {
            path: sourcePath
          });
          if (typeof response.dataBase64 !== "string") {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/readFile returned no base64 content"
            );
          }
          const decoded = Buffer.from(response.dataBase64, "base64").toString(
            "utf8"
          );
          if (decoded !== fixtureContent) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/readFile returned unexpected content"
            );
          }
          return {
            contentMatched: true,
            byteLength: Buffer.byteLength(decoded)
          };
        }
      );

      operations["files.write"] = await this.verifyOperation(
        "files.write",
        "fs/writeFile",
        true,
        async () => {
          await this.request("fs/writeFile", {
            path: writtenPath,
            dataBase64: Buffer.from(writtenContent, "utf8").toString("base64")
          });
          const written = fs.readFileSync(writtenPath, "utf8");
          if (written !== writtenContent) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/writeFile did not persist the expected bytes"
            );
          }
          return {
            contentMatched: true,
            byteLength: Buffer.byteLength(written)
          };
        }
      );

      operations["files.createDirectory"] = await this.verifyOperation(
        "files.createDirectory",
        "fs/createDirectory",
        false,
        async () => {
          await this.request("fs/createDirectory", {
            path: createdDirectory,
            recursive: true
          });
          if (!fs.statSync(createdDirectory).isDirectory()) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/createDirectory did not create a directory"
            );
          }
          return { directoryCreated: true };
        }
      );

      operations["files.copy"] = await this.verifyOperation(
        "files.copy",
        "fs/copy",
        false,
        async () => {
          await this.request("fs/copy", {
            sourcePath,
            destinationPath: copiedPath,
            recursive: false
          });
          if (fs.readFileSync(copiedPath, "utf8") !== fixtureContent) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/copy did not copy the expected bytes"
            );
          }
          return { contentMatched: true };
        }
      );

      operations["search.fileName"] = await this.verifyOperation(
        "search.fileName",
        "fuzzyFileSearch",
        false,
        async () => {
          const response = await this.request<FuzzySearchResponse>(
            "fuzzyFileSearch",
            {
              query: sourceName.slice(0, -4),
              roots: [this.rootPath],
              cancellationToken: null
            }
          );
          if (!Array.isArray(response.files)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fuzzyFileSearch returned no file list"
            );
          }
          const found = response.files.some((value) => {
            const result =
              value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
            return result.file_name === sourceName;
          });
          if (!found) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fuzzyFileSearch did not return the probe file"
            );
          }
          return {
            fixtureFound: true,
            resultCount: response.files.length
          };
        }
      );

      operations["command.exec"] = await this.verifyOperation(
        "command.exec",
        "command/exec",
        true,
        async () => {
          const marker = `chatcockpit-command-${suffix}`;
          const response = await this.request<CommandExecResponse>(
            "command/exec",
            {
              command: [
                process.execPath,
                "-e",
                `process.stdout.write(${JSON.stringify(marker)})`
              ],
              cwd: this.rootPath,
              timeoutMs: 5_000,
              outputBytesCap: 4_096,
              sandboxPolicy: {
                type: "readOnly",
                networkAccess: false
              }
            }
          );
          if (response.exitCode !== 0 || response.stdout !== marker) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "command/exec returned an unexpected buffered result"
            );
          }
          return {
            exitCode: response.exitCode,
            stdoutMatched: true,
            stderrEmpty: response.stderr === ""
          };
        }
      );

      operations["context.skills"] = await this.verifyOperation(
        "context.skills",
        "skills/list",
        true,
        async () => {
          const response = await this.request<{ data?: unknown }>("skills/list", {
            cwds: [this.rootPath],
            forceReload: false
          });
          if (!Array.isArray(response.data)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "skills/list returned no data list"
            );
          }
          return { groupCount: response.data.length };
        }
      );

      operations["context.hooks"] = await this.verifyOperation(
        "context.hooks",
        "hooks/list",
        true,
        async () => {
          const response = await this.request<{ data?: unknown }>("hooks/list", {
            cwds: [this.rootPath]
          });
          if (!Array.isArray(response.data)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "hooks/list returned no data list"
            );
          }
          return { groupCount: response.data.length };
        }
      );

      operations["context.mcpStatus"] = await this.verifyOperation(
        "context.mcpStatus",
        "mcpServerStatus/list",
        true,
        async () => {
          const response = await this.request<{ data?: unknown }>(
            "mcpServerStatus/list",
            { cursor: null, limit: 1, detail: "toolsAndAuthOnly" }
          );
          if (!Array.isArray(response.data)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "mcpServerStatus/list returned no data list"
            );
          }
          return { serverCount: response.data.length };
        }
      );

      operations["context.config"] = await this.verifyOperation(
        "context.config",
        "config/read",
        true,
        async () => {
          const response = await this.request<{ config?: unknown }>("config/read", {
            cwd: this.rootPath,
            includeLayers: false
          });
          if (
            !response.config ||
            typeof response.config !== "object" ||
            Array.isArray(response.config)
          ) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "config/read returned no config object"
            );
          }
          return { configLoaded: true };
        }
      );

      operations["files.remove"] = await this.verifyOperation(
        "files.remove",
        "fs/remove",
        false,
        async () => {
          await this.request("fs/remove", {
            path: copiedPath,
            recursive: false,
            force: false
          });
          if (fs.existsSync(copiedPath)) {
            throw new ServiceError(
              "CODEX_STANDALONE_RESPONSE_INVALID",
              "fs/remove did not remove the probe file"
            );
          }
          return { fileRemoved: true };
        }
      );
    } finally {
      for (const target of [
        sourcePath,
        writtenPath,
        copiedPath,
        createdDirectory
      ]) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }

    operations["search.content"] = unavailableOperation(
      "search.content",
      "NO_FIRST_CLASS_CONTENT_SEARCH_METHOD"
    );
    operations["git.native"] = unavailableOperation(
      "git.native",
      "NO_FIRST_CLASS_GIT_OPERATION_METHOD"
    );

    const turnStartObserved = this.outgoingMethods.includes("turn/start");
    const directExecutionReady = [
      operations["files.read"],
      operations["files.write"],
      operations["files.list"],
      operations["command.exec"]
    ].every((capability) => capability.status === "verified") &&
      !turnStartObserved;

    return {
      schemaVersion: 1,
      runtime: "codex-app-server",
      protocolFamily: "app-server-v2",
      binarySource: this.binary.source,
      binaryVersion: this.binary.version,
      serverProtocolVersion: initialization.protocolVersion,
      probedAt: this.now().toISOString(),
      operations,
      outgoingMethods: [...this.outgoingMethods],
      turnStartObserved,
      directExecutionReady
    };
  }

  private async request<T = Record<string, never>>(
    method: string,
    params: unknown
  ): Promise<T> {
    this.outgoingMethods.push(method);
    return await this.client.request<T>(method, params);
  }

  private async verifyOperation(
    operation: CodexStandaloneOperation,
    method: string,
    safeForChatDirect: boolean,
    verify: () => Promise<Record<string, boolean | number | string | null>>
  ): Promise<CodexStandaloneOperationCapability> {
    try {
      const evidence = await verify();
      return {
        operation,
        method,
        status: "verified",
        safeForChatDirect,
        errorCode: null,
        evidence
      };
    } catch (error) {
      return {
        operation,
        method,
        status:
          error instanceof ServiceError &&
          error.code === "CAPABILITY_UNAVAILABLE"
            ? "unavailable"
            : "failed",
        safeForChatDirect: false,
        errorCode: errorCode(error),
        evidence: {}
      };
    }
  }
}
