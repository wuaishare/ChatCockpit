import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OperatorService } from "../auth/operator-service.js";
import { readIdentityEnv } from "../core/identity-env.js";
import type { RuntimeBuildProvenance } from "../core/build-provenance.js";
import { projectOpenApiForProduct } from "../core/openapi-product-projection.js";
import { isPathInsideRoot, resolvePathInsideRoot } from "../core/path-guards.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { TokenPilotPaths } from "../types.js";
import { sendApiError } from "./errors.js";
import { operatorSessionFromRequest } from "./operator-auth-context.js";
import {
  resolveUiBuildRecovery,
  uiRecoveryLocaleFromAcceptLanguage,
  type UiBuildRecoveryStatus,
  type UiRecoveryLocale
} from "./ui-build-recovery.js";
import { prepareUiRuntimeDistribution } from "./ui-runtime-snapshot.js";

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

interface UiRecoveryCopy {
  notBuiltTitle: string;
  notBuiltHeading: string;
  notBuiltDescription: string;
  notBuiltAction: string;
  notBuiltBuildStep: string;
  notBuiltRestartStep: string;
  notBuiltOpenStep: string;
  notBuiltNote: string;
  restartTitle: string;
  restartHeading: string;
  restartDescription: string;
  restartAction: string;
  restartNote: string;
  rebuildTitle: string;
  rebuildHeading: string;
  rebuildDescription: string;
  rebuildAction: string;
  rebuildNote: string;
}

const UI_RECOVERY_COPY: Record<UiRecoveryLocale, UiRecoveryCopy> = {
  "zh-CN": {
    notBuiltTitle: "Web UI 尚未构建",
    notBuiltHeading: "Web UI 尚未构建",
    notBuiltDescription: "本机 Operator Web UI 需要从 web/dist 中的静态构建产物加载。",
    notBuiltAction: "请完成整套 Runtime 构建，然后重启 Runtime 并重新打开 /ui；不要只单独重建 web/dist。",
    notBuiltBuildStep: "完整构建",
    notBuiltRestartStep: "重启 ChatCockpit Runtime",
    notBuiltOpenStep: "重新打开",
    notBuiltNote: "诊断期间仍可使用 /api/health 与 /openapi.yaml。",
    restartTitle: "Runtime 需要重启",
    restartHeading: "已检测到完整的新构建，Runtime 需要重启",
    restartDescription: "磁盘上的 Control Plane 与 Web UI 已来自同一完整构建 generation，但当前运行中的 Control Plane 仍使用启动时加载的旧 generation。为避免旧后端与新前端混用，Web UI 已暂时阻止加载。",
    restartAction: "请重启 ChatCockpit Runtime，然后重新打开 /ui；无需再次执行 npm run build。",
    restartNote: "/api/health 在重启前仍可用于诊断。",
    rebuildTitle: "构建产物不同步",
    rebuildHeading: "构建产物不同步",
    rebuildDescription: "Control Plane 与 Web UI 没有形成同一个完整且可验证的构建 generation，因此 Web UI 已阻止加载不兼容的客户端。",
    rebuildAction: "请重新构建并部署完整 Runtime 产物集，然后再打开 /ui。源码 checkout 应运行 npm run build，而不是只重建 web/dist。",
    rebuildNote: "/api/health 仍可用于诊断。"
  },
  "en-US": {
    notBuiltTitle: "Web UI Not Built",
    notBuiltHeading: "Web UI is not built yet",
    notBuiltDescription: "The local-first Operator Web UI is served from built static assets under web/dist.",
    notBuiltAction: "Build the complete Runtime artifact set, then restart the Runtime and open /ui again; do not rebuild web/dist by itself.",
    notBuiltBuildStep: "Complete build",
    notBuiltRestartStep: "Restart the ChatCockpit Runtime",
    notBuiltOpenStep: "Open",
    notBuiltNote: "/api/health and /openapi.yaml remain available for diagnostics.",
    restartTitle: "Runtime Restart Required",
    restartHeading: "A complete new build is ready; restart the Runtime",
    restartDescription: "The Control Plane and Web UI on disk now belong to the same complete build generation, but the running Control Plane is still using the generation loaded at startup. The Web UI has been blocked to avoid mixing an old backend with a new client.",
    restartAction: "Restart the ChatCockpit Runtime, then retry /ui. You do not need to run npm run build again.",
    restartNote: "/api/health remains available for diagnostics before the restart.",
    rebuildTitle: "Build Artifacts Out of Sync",
    rebuildHeading: "Build artifacts are out of sync",
    rebuildDescription: "The Control Plane and Web UI do not form one complete, verifiable build generation, so the Web UI has been blocked instead of loading an incompatible client.",
    rebuildAction: "Rebuild and deploy the complete Runtime artifact set, then retry /ui. For a source checkout, run npm run build rather than rebuilding only web/dist.",
    rebuildNote: "/api/health remains available for diagnostics."
  }
};

function htmlLanguage(locale: UiRecoveryLocale): string {
  return locale === "zh-CN" ? "zh-Hans" : "en";
}

function renderUiNotBuiltPage(displayName: string, locale: UiRecoveryLocale): string {
  const copy = UI_RECOVERY_COPY[locale];
  return `<!doctype html>
<html lang="${htmlLanguage(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayName} · ${copy.notBuiltTitle}</title>
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
      <h1>${displayName} ${copy.notBuiltHeading}</h1>
      <p>${copy.notBuiltDescription.replace("web/dist", "<code>web/dist</code>")}</p>
      <p>${copy.notBuiltAction.replace("/ui", "<code>/ui</code>").replace("web/dist", "<code>web/dist</code>")}</p>
      <ul>
        <li>${copy.notBuiltBuildStep}: <code>npm run build</code></li>
        <li>${copy.notBuiltRestartStep}</li>
        <li>${copy.notBuiltOpenStep} <code>http://127.0.0.1:4318/ui</code></li>
      </ul>
      <p class="note">${copy.notBuiltNote.replace("/api/health", "<code>/api/health</code>").replace("/openapi.yaml", "<code>/openapi.yaml</code>")}</p>
    </main>
  </body>
</html>`;
}

function renderUiBuildRecoveryPage(
  displayName: string,
  locale: UiRecoveryLocale,
  status: Exclude<UiBuildRecoveryStatus, "ok">
): string {
  const copy = UI_RECOVERY_COPY[locale];
  const restartRequired = status === "restart-required";
  const title = restartRequired ? copy.restartTitle : copy.rebuildTitle;
  const heading = restartRequired ? copy.restartHeading : copy.rebuildHeading;
  const description = restartRequired ? copy.restartDescription : copy.rebuildDescription;
  const action = restartRequired ? copy.restartAction : copy.rebuildAction;
  const note = restartRequired ? copy.restartNote : copy.rebuildNote;
  return `<!doctype html>
<html lang="${htmlLanguage(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayName} · ${title}</title>
  </head>
  <body>
    <main style="max-width: 760px; margin: 56px auto; padding: 0 24px; font: 16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif;">
      <h1>${displayName} · ${heading}</h1>
      <p>${description}</p>
      <p>${action.replace("/ui", "<code>/ui</code>").replace("npm run build", "<code>npm run build</code>").replace("web/dist", "<code>web/dist</code>")}</p>
      <p>${note.replace("/api/health", "<code>/api/health</code>")}</p>
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
  operator?: OperatorService,
  runtimeBuildProvenance: RuntimeBuildProvenance | null = null
): void {
  const identity = productIdentityForKey(paths.productIdentity);
  const uiDistribution = prepareUiRuntimeDistribution(
    paths,
    runtimeBuildProvenance
  );
  const uiDistDir = uiDistribution.uiDistDir;
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

  app.get("/ui", async (request, reply) => {
    reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
    reply.type("text/html; charset=utf-8");
    const locale = uiRecoveryLocaleFromAcceptLanguage(request.headers["accept-language"]);
    reply.header("Content-Language", locale);
    reply.header("Vary", "Accept-Language");
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      return renderUiNotBuiltPage(identity.displayName, locale);
    }
    if (!uiDistribution.immutableSnapshot) {
      const recovery = resolveUiBuildRecovery(paths.installRoot, runtimeBuildProvenance);
      if (recovery.status !== "ok") {
        reply.code(503);
        return renderUiBuildRecoveryPage(identity.displayName, locale, recovery.status);
      }
    }
    return renderUiIndex();
  });

  app.get("/ui/*", async (request, reply) => {
    const locale = uiRecoveryLocaleFromAcceptLanguage(request.headers["accept-language"]);
    reply.header("Content-Language", locale);
    reply.header("Vary", "Accept-Language");
    const indexPath = path.join(uiDistDir, "index.html");
    if (!hasUiDist || !uiRootRealPath || !fs.existsSync(indexPath)) {
      reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
      reply.type("text/html; charset=utf-8");
      return renderUiNotBuiltPage(identity.displayName, locale);
    }

    const requestUrl = request.url;
    const rawSuffixForIntegrity = requestUrl
      .split("?", 1)[0]
      .slice("/ui/".length);
    const recovery = uiDistribution.immutableSnapshot
      ? null
      : resolveUiBuildRecovery(
          paths.installRoot,
          runtimeBuildProvenance,
          rawSuffixForIntegrity.startsWith("assets/") ? "generation" : "integrity"
        );
    if (recovery && recovery.status !== "ok") {
      if (rawSuffixForIntegrity.startsWith("assets/")) {
        const restartRequired = recovery.status === "restart-required";
        return sendApiError(
          reply,
          503,
          restartRequired ? "UI_RUNTIME_RESTART_REQUIRED" : "UI_BUILD_GENERATION_MISMATCH",
          restartRequired
            ? locale === "zh-CN"
              ? "已检测到完整的新构建；请重启 ChatCockpit Runtime 后重新加载 Web UI"
              : "A complete new build is ready; restart the ChatCockpit Runtime before reloading the Web UI"
            : locale === "zh-CN"
              ? "Web UI 构建产物与 Control Plane 不属于同一个完整且可验证的构建 generation"
              : "Web UI artifacts do not form the same complete, verifiable build generation as the Control Plane"
        );
      }
      reply.header("Cache-Control", UI_DOCUMENT_CACHE_CONTROL);
      reply.type("text/html; charset=utf-8");
      return reply.code(503).send(
        renderUiBuildRecoveryPage(identity.displayName, locale, recovery.status)
      );
    }

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
