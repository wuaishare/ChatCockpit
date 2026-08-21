import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OperatorService } from "../auth/operator-service.js";
import { readIdentityEnv } from "../core/identity-env.js";
import { projectOpenApiForProduct } from "../core/openapi-product-projection.js";
import { isPathInsideRoot, resolvePathInsideRoot } from "../core/path-guards.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { TokenPilotPaths } from "../types.js";
import { sendApiError } from "./errors.js";
import { operatorSessionFromRequest } from "./operator-auth-context.js";

const UI_DOCUMENT_CACHE_CONTROL = "no-store";
const UI_HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

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

function resolveOpenApiServerUrl(
  request: FastifyRequest,
  paths: TokenPilotPaths
): string {
  const configured = readIdentityEnv("PUBLIC_BASE_URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const protocol = request.protocol;
  const host = request.host?.trim();

  if (!host) {
    const identity = productIdentityForKey(paths.productIdentity);
    return `https://${identity.packageName}.example.com`;
  }

  return `${protocol}://${host}`;
}

function renderOpenApiDocument(
  request: FastifyRequest,
  paths: TokenPilotPaths
): string {
  const filePath = path.join(paths.installRoot, "openapi", "chatcockpit.openapi.yaml");
  const source = fs.readFileSync(filePath, "utf8");
  const serverUrl = resolveOpenApiServerUrl(request, paths);
  return projectOpenApiForProduct(source, paths.productIdentity, serverUrl);
}

function renderUiNotBuiltPage(displayName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayName} Web UI Not Built</title>
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
      <h1>${displayName} Web UI is not built yet</h1>
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

function renderPrivacyPolicy(displayName: string): string {
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayName} Privacy Policy</title>
  </head>
  <body>
    <main style="max-width: 760px; margin: 40px auto; font: 16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif;">
      <h1>${displayName} Privacy Policy</h1>
      <p>${displayName} is a local-first automation layer for repository packaging, task-pack generation, and local runner orchestration.</p>
      <p>For this MVP, requests sent to the ${displayName} control plane may be logged locally for debugging and job traceability. Repository artifacts are generated on the local machine and remain under the local workspace unless the operator explicitly exposes the control plane or shares generated files.</p>
      <p>This MVP does not intentionally transmit repository contents to third-party services except through actions explicitly initiated by the operator, such as Custom GPT Actions calling the configured HTTPS endpoint.</p>
      <p>Operators are responsible for securing bearer tokens, public endpoints, and exposed infrastructure such as reverse proxies and tunnels.</p>
    </main>
  </body>
</html>`;
}

export function registerStaticRoutes(
  app: FastifyInstance,
  paths: TokenPilotPaths,
  secureEntryPath = "/ui",
  operator?: OperatorService
): void {
  const identity = productIdentityForKey(paths.productIdentity);
  const uiDistDir = path.join(paths.installRoot, "web", "dist");
  const hasUiDist = fs.existsSync(uiDistDir);
  const uiRootRealPath = hasUiDist ? fs.realpathSync(uiDistDir) : null;

  app.get("/openapi.yaml", async (request, reply) => {
    reply.type("text/yaml");
    return renderOpenApiDocument(request, paths);
  });

  const renderUiIndex = (): string => {
    const source = fs.readFileSync(path.join(uiDistDir, "index.html"), "utf8");
    const withStableAssetBase = source.replaceAll("./assets/", "/ui/assets/");
    return withStableAssetBase.replace(
      "</head>",
      `    <meta name="chatcockpit-console-base" content="/ui">\n  </head>`
    );
  };

  if (secureEntryPath !== "/ui") {
    const redirectSecureEntry = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
      const requestUrl = new URL(request.url, "http://chatcockpit.local");
      if (requestUrl.searchParams.get("probe") === "1") {
        return reply.code(204).send();
      }
      if (operatorSessionFromRequest(request)) {
        return reply.redirect("/ui/", 303);
      }
      if (!operator) {
        return sendApiError(reply, 503, "OPERATOR_AUTH_UNAVAILABLE", "Web Owner authentication is unavailable");
      }
      const gate = operator.createSecureLoginGate();
      const params = new URLSearchParams({ gate: gate.gateSecret });
      return reply.redirect(`/ui/login?${params.toString()}`, 303);
    };

    app.get(secureEntryPath, redirectSecureEntry);
    app.get(`${secureEntryPath}/login`, redirectSecureEntry);
  }

  app.get("/ui", async (_request, reply) => {
    reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
    reply.type("text/html; charset=utf-8");
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      return renderUiNotBuiltPage(identity.displayName);
    }
    return renderUiIndex();
  });

  app.get("/ui/*", async (request, reply) => {
    const indexPath = path.join(uiDistDir, "index.html");
    if (!hasUiDist || !uiRootRealPath || !fs.existsSync(indexPath)) {
      reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
      reply.type("text/html; charset=utf-8");
      return renderUiNotBuiltPage(identity.displayName);
    }

    const requestUrl = request.url;
    const rawSuffix = requestUrl
      .split("?", 1)[0]
      .slice("/ui/".length);
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
          if (suffix.startsWith("assets/")) {
            reply.header("Cache-Control", UI_HASHED_ASSET_CACHE_CONTROL);
          } else if (path.extname(realAssetPath).toLowerCase() === ".html") {
            reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
          }
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

    if (suffix.startsWith("assets/")) {
      return sendApiError(
        reply,
        404,
        "UI_ASSET_NOT_FOUND",
        "Requested Web UI asset is not present in the current build"
      );
    }

    reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
    reply.type("text/html; charset=utf-8");
    return renderUiIndex();
  });

  app.get("/privacy-policy", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderPrivacyPolicy(identity.displayName);
  });
}
