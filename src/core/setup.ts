import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { TokenPilotPaths } from "../types.js";
import { ensureWorkspaceDirs } from "./paths.js";

export interface InitResult {
  ok: true;
  envPath: string;
  created: boolean;
  tokenGenerated: boolean;
  messages: string[];
}

function generateLocalToken(): string {
  return `tp_local_${crypto.randomBytes(24).toString("base64url")}`;
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

  const token = generateLocalToken();
  const content = [
    "# TokenPilot local runtime config.",
    "# This file is machine-local state under .tokenpilot/runtime and must not be committed.",
    "TOKENPILOT_HOST=127.0.0.1",
    "TOKENPILOT_PORT=4318",
    "TOKENPILOT_EXPOSED=false",
    `TOKENPILOT_API_TOKEN=${token}`,
    "TOKENPILOT_PUBLIC_BASE_URL=",
    "TOKENPILOT_RUNNER_INTERVAL=3",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, "utf8");
  messages.push(`created ${envPath}`);
  messages.push("generated a local bearer token for this machine");
  messages.push("keep .tokenpilot/runtime/server.env private");

  return {
    ok: true,
    envPath,
    created: true,
    tokenGenerated: true,
    messages
  };
}
