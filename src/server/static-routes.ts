import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { isPathInsideRoot, resolvePathInsideRoot } from "../core/path-guards.js";
import type { TokenPilotPaths } from "../types.js";
import { sendApiError } from "./errors.js";

const uiAssetContentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function uiAssetContentType(filePath: string): string {
  return uiAssetContentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveOpenApiServerUrl(request: FastifyRequest): string {
  const configured = process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProtoHeader = request.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocol = forwardedProto?.split(",")[0]?.trim() || "http";
  const host = request.headers.host?.trim();

  if (!host) {
    return "https://tokenpilot.example.com";
  }

  return `${protocol}://${host}`;
}

function renderOpenApiDocument(request: FastifyRequest, repoRoot: string): string {
  const filePath = path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml");
  const source = fs.readFileSync(filePath, "utf8");
  const serverUrl = resolveOpenApiServerUrl(request);

  return source.replace(
    /^servers:\n  - url: .+$/m,
    `servers:\n  - url: ${serverUrl}`
  );
}

function renderUiNotBuiltPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Web UI Not Built</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f2ea;
        --panel: rgba(255, 255, 255, 0.88);
        --text: #1d2a24;
        --muted: #5d6d63;
        --line: rgba(29, 42, 36, 0.12);
        --accent: #235744;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(35, 87, 68, 0.12), transparent 34%),
          linear-gradient(135deg, #f5f2ea 0%, #ebe4d7 100%);
        color: var(--text);
        font: 15px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 24px;
      }
      main {
        width: min(720px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 22px 60px rgba(38, 54, 44, 0.12);
        backdrop-filter: blur(18px);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(35, 87, 68, 0.08);
        padding: 2px 6px;
        border-radius: 8px;
      }
      ul {
        margin: 16px 0 0;
        padding-left: 18px;
      }
      li + li {
        margin-top: 6px;
      }
      .note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TokenPilot Web UI is not built yet</h1>
      <p>The local-first operator Web UI is served from built static assets under <code>web/dist</code>.</p>
      <p>Build the frontend first, then restart the server and open <code>/ui</code> again.</p>
      <ul>
        <li><code>npm run build:web</code></li>
        <li><code>npm run server</code></li>
        <li>Open <code>http://127.0.0.1:4318/ui</code></li>
      </ul>
      <p class="note">Current public-safe entry points remain <code>/api/health</code> and <code>/openapi.yaml</code>. Full HTTPS / Custom GPT Actions automation loop is still under validation.</p>
    </main>
  </body>
</html>`;
}

function renderPrivacyPolicy(): string {
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Privacy Policy</title>
  </head>
  <body>
    <main style="max-width: 760px; margin: 40px auto; font: 16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif;">
      <h1>TokenPilot Privacy Policy</h1>
      <p>TokenPilot is a local-first automation layer for repository packaging, task-pack generation, and local runner orchestration.</p>
      <p>For this MVP, requests sent to the TokenPilot control plane may be logged locally for debugging and job traceability. Repository artifacts are generated on the local machine and remain under the local workspace unless the operator explicitly exposes the control plane or shares generated files.</p>
      <p>This MVP does not intentionally transmit repository contents to third-party services except through actions explicitly initiated by the operator, such as Custom GPT Actions calling the configured HTTPS endpoint.</p>
      <p>Operators are responsible for securing bearer tokens, public endpoints, and exposed infrastructure such as reverse proxies and tunnels.</p>
    </main>
  </body>
</html>`;
}

export function registerStaticRoutes(
  app: FastifyInstance,
  paths: TokenPilotPaths
): void {
  const uiDistDir = path.join(paths.installRoot, "web", "dist");
  const hasUiDist = fs.existsSync(uiDistDir);
  const uiRootRealPath = hasUiDist ? fs.realpathSync(uiDistDir) : null;

  app.get("/openapi.yaml", async (request, reply) => {
    reply.type("text/yaml");
    return renderOpenApiDocument(request, paths.installRoot);
  });

  app.get("/ui", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      return renderUiNotBuiltPage();
    }
    return fs.readFileSync(path.join(uiDistDir, "index.html"), "utf8");
  });

  app.get("/ui/*", async (request, reply) => {
    const indexPath = path.join(uiDistDir, "index.html");
    if (!hasUiDist || !uiRootRealPath || !fs.existsSync(indexPath)) {
      reply.type("text/html; charset=utf-8");
      return renderUiNotBuiltPage();
    }

    const requestUrl = request.url;
    const rawSuffix = requestUrl.split("?", 1)[0].slice("/ui/".length);
    let suffix: string;
    try {
      suffix = decodeURIComponent(rawSuffix);
    } catch {
      return sendApiError(
        reply,
        400,
        "INVALID_UI_ASSET_PATH",
        "Invalid UI asset path encoding"
      );
    }

    if (suffix) {
      try {
        const { absolutePath } = resolvePathInsideRoot(
          uiDistDir,
          suffix,
          "UI asset path"
        );
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          const realAssetPath = fs.realpathSync(absolutePath);
          if (!isPathInsideRoot(uiRootRealPath, realAssetPath)) {
            return sendApiError(
              reply,
              400,
              "INVALID_UI_ASSET_PATH",
              "UI asset path must stay within the built Web UI directory"
            );
          }

          reply.header("X-Content-Type-Options", "nosniff");
          reply.type(uiAssetContentType(realAssetPath));
          return fs.readFileSync(realAssetPath);
        }
      } catch (error) {
        return sendApiError(
          reply,
          400,
          "INVALID_UI_ASSET_PATH",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    reply.type("text/html; charset=utf-8");
    return fs.readFileSync(indexPath, "utf8");
  });

  app.get("/privacy-policy", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderPrivacyPolicy();
  });
}
