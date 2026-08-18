import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");

function readPackageVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version?: string;
  };
  const version = packageJson.version?.trim() || "0.0.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function readGitValue(args: string[], fallback: string): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}

export default defineConfig(() => {
  const apiTarget = process.env.CHATCOCKPIT_WEB_API_ORIGIN || "http://127.0.0.1:4318";
  const productVersion = readPackageVersion();
  const schemaVersion = readGitValue(["rev-list", "--count", "HEAD"], "0");
  const buildVersion = readGitValue(
    ["log", "-1", "--format=%cd", "--date=format:%y.%m%d.%H%M%S"],
    "00.0000.000000"
  );

  return {
    root: webRoot,
    base: "./",
    plugins: [react()],
    define: {
      __CHATCOCKPIT_VERSION__: JSON.stringify({
        version: `${productVersion} (${schemaVersion})`,
        productVersion,
        schemaVersion,
        buildVersion
      })
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }

            if (id.includes("@lobehub/ui") || id.includes("antd-style")) {
              return "ui-core";
            }

            if (id.includes("motion")) {
              return "motion-vendor";
            }

            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor";
            }
          }
        }
      }
    },
    server: {
      host: "127.0.0.1",
      port: 4174,
      proxy: {
        "/api": apiTarget,
        "/openapi.yaml": apiTarget
      }
    },
    preview: {
      host: "127.0.0.1",
      port: 4174
    }
  };
});
