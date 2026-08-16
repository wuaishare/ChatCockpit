import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { TokenPilotPaths } from "../types.js";
import { runtimeIdentityEnvName } from "../core/identity-env.js";
import { ensureWorkspaceDirs } from "../core/paths.js";
import { productIdentityForKey } from "../core/product-identity.js";
import { initLocalRuntime } from "../core/setup.js";

export interface MachineApiTokenStatus {
  configured: boolean;
  fingerprint: string | null;
}

export interface MachineApiTokenRotationResult extends MachineApiTokenStatus {
  token: string;
  envPath: string;
}

function serverEnvironmentPath(paths: TokenPilotPaths): string {
  return path.join(paths.runtimeDir, "server.env");
}

function apiTokenName(paths: TokenPilotPaths): string {
  return runtimeIdentityEnvName("API_TOKEN", paths.productIdentity);
}

function tokenFingerprint(token: string): string {
  const suffix = token.slice(-6);
  const prefix = token.startsWith("cc_local_")
    ? "cc_local"
    : token.startsWith("tp_local_")
      ? "tp_local"
      : "token";
  return `${prefix}_…${suffix}`;
}

function extractToken(source: string, name: string): string | null {
  const matches = source
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}=`));
  if (matches.length > 1) {
    throw new Error(`${name} is defined more than once in server.env`);
  }
  if (matches.length === 0) return null;
  const value = matches[0]!.slice(name.length + 1).trim();
  return value || null;
}

function generateToken(paths: TokenPilotPaths): string {
  const identity = productIdentityForKey(paths.productIdentity);
  return `${identity.localTokenPrefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

function privateAtomicWrite(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function readMachineApiToken(paths: TokenPilotPaths): string | null {
  const envPath = serverEnvironmentPath(paths);
  if (!fs.existsSync(envPath)) return null;
  const source = fs.readFileSync(envPath, "utf8");
  return extractToken(source, apiTokenName(paths));
}

export function machineApiTokenStatus(paths: TokenPilotPaths): MachineApiTokenStatus {
  const token = readMachineApiToken(paths);
  return {
    configured: Boolean(token),
    fingerprint: token ? tokenFingerprint(token) : null
  };
}

export function rotateMachineApiToken(paths: TokenPilotPaths): MachineApiTokenRotationResult {
  ensureWorkspaceDirs(paths);
  const envPath = serverEnvironmentPath(paths);
  if (!fs.existsSync(envPath)) {
    initLocalRuntime(paths);
    const token = readMachineApiToken(paths);
    if (!token) throw new Error("Machine API token could not be initialized");
    return {
      configured: true,
      fingerprint: tokenFingerprint(token),
      token,
      envPath
    };
  }

  const name = apiTokenName(paths);
  const token = generateToken(paths);
  const existing = fs.readFileSync(envPath, "utf8");
  extractToken(existing, name);

  const replacement = `${name}=${token}`;
  let content: string;
  if (existing.split(/\r?\n/).some((line) => line.startsWith(`${name}=`))) {
    content = existing
      .split(/\r?\n/)
      .map((line) => (line.startsWith(`${name}=`) ? replacement : line))
      .join("\n");
  } else {
    const base = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
    content = `${base}${replacement}\n`;
  }

  privateAtomicWrite(envPath, content);
  return {
    configured: true,
    fingerprint: tokenFingerprint(token),
    token,
    envPath
  };
}
