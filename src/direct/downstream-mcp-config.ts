import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { readIdentityEnv } from "../core/identity-env.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../core/product-identity.js";
import type { DownstreamMcpCapabilityMapping } from "./downstream-mcp-types.js";

const capabilitySchema = z.enum([
  "files.read",
  "files.readBatch",
  "files.list",
  "files.write",
  "files.edit",
  "search.content",
  "shell.exec",
  "git.status",
  "git.diff",
  "git.commit",
  "git.log"
]);

const scopeSchema = z.enum(["workspace", "host"]);
const accessSchema = z.enum(["read", "write"]);
const executorIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,159}$/);

const mappingSchema = z.object({
  capability: capabilitySchema,
  toolName: z.string().min(1).max(200),
  scopes: z.array(scopeSchema).min(1),
  access: z.array(accessSchema).min(1)
});

const stdioTransportSchema = z.object({
  kind: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  maxBufferBytes: z.number().int().positive().max(16 * 1024 * 1024).default(1024 * 1024),
  maxStderrBytes: z.number().int().positive().max(1024 * 1024).default(64 * 1024)
});

const executorSchema = z.object({
  id: executorIdSchema,
  displayName: z.string().min(1).max(160),
  transport: stdioTransportSchema,
  mappings: z.array(mappingSchema).min(1)
});

const hostRootSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  displayName: z.string().min(1).max(160),
  path: z.string().min(1).refine((value) => path.isAbsolute(value), {
    message: "Host root path must be absolute"
  }),
  access: z.array(z.enum(["read", "write"])).min(1).default(["read"])
});

const configSchema = z.object({
  schemaVersion: z.literal(1),
  hostRoots: z.array(hostRootSchema).default([]),
  executors: z.array(executorSchema).default([])
});

export interface DownstreamMcpStdioExecutorConfig {
  id: string;
  displayName: string;
  transport: {
    kind: "stdio";
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
    maxBufferBytes: number;
    maxStderrBytes: number;
  };
  mappings: DownstreamMcpCapabilityMapping[];
}

export interface DirectHostRootConfig {
  id: string;
  displayName: string;
  path: string;
  access: ("read" | "write")[];
}

export interface DownstreamMcpExecutorsConfig {
  schemaVersion: 1;
  hostRoots: DirectHostRootConfig[];
  executors: DownstreamMcpStdioExecutorConfig[];
}

export function getDownstreamMcpExecutorsConfigPath(): string {
  return (
    readIdentityEnv("DIRECT_EXECUTORS_CONFIG_PATH") ??
    path.join(os.homedir(), DEFAULT_PRODUCT_IDENTITY.stateDirName, "direct-executors.json")
  );
}

export function loadDownstreamMcpExecutorsConfig(
  configPath = getDownstreamMcpExecutorsConfigPath()
): DownstreamMcpExecutorsConfig {
  if (!fs.existsSync(configPath)) {
    return { schemaVersion: 1, hostRoots: [], executors: [] };
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Direct executor local config failed validation");
  }

  const rootIds = new Set<string>();
  for (const hostRoot of parsed.data.hostRoots) {
    if (rootIds.has(hostRoot.id)) {
      throw new Error(`Duplicate Host Direct root id: ${hostRoot.id}`);
    }
    rootIds.add(hostRoot.id);
  }

  const ids = new Set<string>();
  for (const executor of parsed.data.executors) {
    if (ids.has(executor.id)) {
      throw new Error(`Duplicate Direct executor id: ${executor.id}`);
    }
    if (!executor.id.startsWith("downstream-mcp:")) {
      throw new Error(
        `Downstream MCP executor id must use downstream-mcp: prefix: ${executor.id}`
      );
    }
    ids.add(executor.id);
  }

  return parsed.data as DownstreamMcpExecutorsConfig;
}
