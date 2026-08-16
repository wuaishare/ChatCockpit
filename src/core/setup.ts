import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { TokenPilotPaths } from "../types.js";
import { runtimeIdentityEnvName } from "./identity-env.js";
import { ensureWorkspaceDirs } from "./paths.js";
import { productIdentityForKey } from "./product-identity.js";

export interface InitResult {
  ok: true;
  envPath: string;
  created: boolean;
  tokenGenerated: boolean;
  messages: string[];
}

function generateLocalToken(prefix: "tp_local" | "cc_local"): string {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

export function initLocalRuntime(paths: TokenPilotPaths, options: { force?: boolean } = {}): InitResult {
  ensureWorkspaceDirs(paths);
  const envPath = path.join(paths.runtimeDir, "server.env");
  const messages: string[] = [];

  if (fs.existsSync(envPath) && !options.force) {
    return {
      ok: true,
      envPath,
      created: false,
      tokenGenerated: false,
      messages: [
        "server.env already exists; nothing was overwritten.",
        "Run doctor --fix to create missing runtime directories without replacing existing secrets."
      ]
    };
  }

  const identity = productIdentityForKey(paths.productIdentity);
  const token = generateLocalToken(identity.localTokenPrefix);
  const envName = (key: Parameters<typeof runtimeIdentityEnvName>[0]) =>
    runtimeIdentityEnvName(key, paths.productIdentity);
  const content = [
    `# ${identity.displayName} local runtime config.`,
    `# This file is machine-local state under ${identity.stateDirName}/runtime and must not be committed.`,
    `${envName("HOST")}=127.0.0.1`,
    `${envName("PORT")}=4318`,
    `${envName("EXPOSED")}=false`,
    `${envName("API_TOKEN")}=${token}`,
    `${envName("PUBLIC_BASE_URL")}=`,
    `${identity.envPrefix}_RUNNER_INTERVAL=3`,
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  messages.push(`created ${envPath}`);
  messages.push("generated a local bearer token for this machine");
  messages.push(`keep ${identity.stateDirName}/runtime/server.env private`);

  return {
    ok: true,
    envPath,
    created: true,
    tokenGenerated: true,
    messages
  };
}
