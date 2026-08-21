import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { OAuthPublicConfig } from "./oauth-config.js";
import { OAuthProtocolError, OAuthService } from "./oauth-service.js";
import { operatorSessionFromRequest } from "../server/operator-auth-context.js";
import { buildContentSecurityPolicy } from "../server/security-headers.js";

interface UnknownRecord {
  [key: string]: unknown;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringField(value: unknown, name: string): string {
  const item = record(value)[name];
  return typeof item === "string" ? item : "";
}

function optionalStringField(value: unknown, name: string): string | undefined {
  const item = record(value)[name];
  return typeof item === "string" ? item : undefined;
}

function stringArrayField(value: unknown, name: string): string[] {
  const item = record(value)[name];
  return Array.isArray(item) && item.every((entry) => typeof entry === "string")
    ? item
    : [];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
}

function sendOAuthError(
  reply: FastifyReply,
  error: unknown
): unknown {
  noStore(reply);
  if (error instanceof OAuthProtocolError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      error_description: error.message
    });
  }
  throw error;
}

function readQuery(request: FastifyRequest): UnknownRecord {
  return record(request.query);
}

function parseFormBody(body: unknown): UnknownRecord {
  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  if (typeof body === "string") {
    return Object.fromEntries(new URLSearchParams(body).entries());
  }
  return record(body);
}

type OAuthApprovalLocale = "zh-CN" | "en-US";

interface OAuthApprovalCopy {
  title: string;
  requestAccess: string;
  scope: string;
  resource: string;
  signedInAs: string;
  authorize: string;
  deny: string;
  authorizing: string;
  denying: string;
}

const OAUTH_APPROVAL_COPY: Record<OAuthApprovalLocale, OAuthApprovalCopy> = {
  "zh-CN": {
    title: "授权 {displayName} MCP",
    requestAccess: "正在请求访问您的 {displayName} MCP 端点。",
    scope: "权限范围",
    resource: "资源",
    signedInAs: "当前登录账号",
    authorize: "授权",
    deny: "拒绝",
    authorizing: "授权中…",
    denying: "拒绝中…"
  },
  "en-US": {
    title: "Authorize {displayName} MCP",
    requestAccess: "is requesting access to your {displayName} MCP endpoint.",
    scope: "Scope",
    resource: "Resource",
    signedInAs: "Signed in as",
    authorize: "Authorize",
    deny: "Deny",
    authorizing: "Authorizing…",
    denying: "Denying…"
  }
};

function isSimplifiedChineseLanguage(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-sg" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-");
}

function localeFromUiLocales(value: string | undefined): OAuthApprovalLocale | null {
  if (!value) return null;
  for (const locale of value.split(/\s+/).filter(Boolean)) {
    if (isSimplifiedChineseLanguage(locale)) return "zh-CN";
    if (locale.trim().toLowerCase().startsWith("en")) return "en-US";
  }
  return null;
}

function localeFromAcceptLanguage(value: string | string[] | undefined): OAuthApprovalLocale {
  const source = Array.isArray(value) ? value.join(",") : value ?? "";
  const languages = source
    .split(",")
    .map((entry) => entry.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  return languages.some(isSimplifiedChineseLanguage) ? "zh-CN" : "en-US";
}

function approvalPage(input: {
  requestId: string;
  clientName: string;
  scope: string;
  resource: string;
  displayName: string;
  username: string;
  csrfToken: string;
  locale: OAuthApprovalLocale;
}): string {
  const copy = OAUTH_APPROVAL_COPY[input.locale];
  const title = copy.title.replace("{displayName}", input.displayName);
  const requestAccess = copy.requestAccess.replace("{displayName}", input.displayName);
  return `<!doctype html>
<html lang="${escapeHtml(input.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
    main { width: min(560px, calc(100vw - 32px)); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 24px; box-sizing: border-box; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.6; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    button { padding: 10px 16px; border: 0; border-radius: 8px; font: inherit; font-weight: 700; cursor: pointer; }
    button[value="deny"] { background: color-mix(in srgb, CanvasText 10%, transparent); color: CanvasText; }
    .meta { font-size: 13px; opacity: .72; }
    .session { margin-top: 18px; padding-top: 16px; border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p><strong>${escapeHtml(input.clientName)}</strong> ${escapeHtml(requestAccess)}</p>
    <p class="meta">${escapeHtml(copy.scope)}: ${escapeHtml(input.scope)}<br>${escapeHtml(copy.resource)}: ${escapeHtml(input.resource)}</p>
    <p class="session">${escapeHtml(copy.signedInAs)} <strong>${escapeHtml(input.username)}</strong></p>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="request_id" value="${escapeHtml(input.requestId)}">
      <input type="hidden" name="csrf_token" value="${escapeHtml(input.csrfToken)}">
      <input type="hidden" name="decision" value="">
      <div class="actions">
        <button type="submit" name="decision" value="approve" data-pending-label="${escapeHtml(copy.authorizing)}">${escapeHtml(copy.authorize)}</button>
        <button type="submit" name="decision" value="deny" data-pending-label="${escapeHtml(copy.denying)}">${escapeHtml(copy.deny)}</button>
      </div>
    </form>
  </main>
  <script src="/oauth/approval.js" defer></script>
</body>
</html>`;
}

const APPROVAL_SCRIPT = `(() => {
  const form = document.querySelector("form");
  if (!(form instanceof HTMLFormElement)) return;

  let submitted = false;
  form.addEventListener("submit", (event) => {
    if (submitted) {
      event.preventDefault();
      return;
    }
    submitted = true;
    form.setAttribute("aria-busy", "true");

    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement) {
      const decision = form.querySelector('input[type="hidden"][name="decision"]');
      if (decision instanceof HTMLInputElement) decision.value = submitter.value;
      submitter.textContent = submitter.dataset.pendingLabel || submitter.textContent;
    }
    for (const button of form.querySelectorAll('button[type="submit"]')) {
      if (button instanceof HTMLButtonElement) button.disabled = true;
    }
  });
})();`;

function ensureUrlEncodedParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/x-www-form-urlencoded")) return;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        const text = typeof body === "string" ? body : body.toString("utf8");
        done(null, new URLSearchParams(text));
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  service: OAuthService,
  config: OAuthPublicConfig,
  consolePathPrefix = "/ui"
): void {
  ensureUrlEncodedParser(app);

  const protectedResourceMetadata = async (_request: FastifyRequest, reply: FastifyReply) => {
    noStore(reply);
    return {
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: config.resourceScopesSupported,
      bearer_methods_supported: ["header"],
      resource_name: `${config.displayName} MCP`
    };
  };
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);

  app.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
    noStore(reply);
    return {
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      registration_endpoint: config.registrationEndpoint,
      revocation_endpoint: config.revocationEndpoint,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: config.scopesSupported
    };
  });

  app.get("/oauth/approval.js", async (_request, reply) => {
    noStore(reply);
    reply.type("application/javascript; charset=utf-8");
    return APPROVAL_SCRIPT;
  });

  app.post("/oauth/register", async (request, reply) => {
    try {
      const body = record(request.body);
      const result = service.registerClient({
        clientName:
          typeof body.client_name === "string" ? body.client_name : undefined,
        redirectUris: stringArrayField(body, "redirect_uris"),
        grantTypes: Array.isArray(body.grant_types)
          ? stringArrayField(body, "grant_types")
          : undefined,
        responseTypes: Array.isArray(body.response_types)
          ? stringArrayField(body, "response_types")
          : undefined,
        tokenEndpointAuthMethod:
          typeof body.token_endpoint_auth_method === "string"
            ? body.token_endpoint_auth_method
            : undefined
      });
      noStore(reply);
      return reply.code(201).send({
        client_id: result.clientId,
        client_id_issued_at: result.clientIdIssuedAt,
        client_name: result.clientName,
        redirect_uris: result.redirectUris,
        grant_types: result.grantTypes,
        response_types: result.responseTypes,
        token_endpoint_auth_method: result.tokenEndpointAuthMethod
      });
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });

  app.get("/oauth/authorize", async (request, reply) => {
    try {
      const query = readQuery(request);
      const existingRequestId = optionalStringField(query, "request_id")?.trim();
      const requestedUiLocales = optionalStringField(query, "ui_locales")?.trim();
      const requestedLocale = localeFromUiLocales(requestedUiLocales);
      const locale = requestedLocale ?? localeFromAcceptLanguage(request.headers["accept-language"]);
      const pending = existingRequestId
        ? service.getAuthorizationForApproval(existingRequestId)
        : service.beginAuthorization({
            clientId: stringField(query, "client_id"),
            redirectUri: stringField(query, "redirect_uri"),
            responseType: stringField(query, "response_type"),
            scope: stringField(query, "scope"),
            resource: stringField(query, "resource"),
            state: optionalStringField(query, "state"),
            codeChallenge: stringField(query, "code_challenge"),
            codeChallengeMethod: stringField(query, "code_challenge_method")
          });
      const client = service.store.getClient(pending.clientId);
      if (!client) {
        throw new OAuthProtocolError("invalid_client", "OAuth client disappeared", 401);
      }

      const operatorSession = operatorSessionFromRequest(request);
      noStore(reply);
      if (!operatorSession) {
        const continuationParams = new URLSearchParams({ request_id: pending.requestId });
        if (requestedLocale) continuationParams.set("ui_locales", requestedLocale);
        const continuation = `/oauth/authorize?${continuationParams.toString()}`;
        const loginUrl = `${consolePathPrefix}/login?returnTo=${encodeURIComponent(continuation)}`;
        return reply.redirect(loginUrl, 302);
      }

      reply.header(
        "content-security-policy",
        buildContentSecurityPolicy([new URL(pending.redirectUri).origin])
      );
      reply.type("text/html; charset=utf-8");
      return approvalPage({
        requestId: pending.requestId,
        clientName: client.clientName,
        scope: pending.scope,
        resource: pending.resource,
        displayName: config.displayName,
        username: operatorSession.username,
        csrfToken: operatorSession.csrfToken,
        locale
      });
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });

  app.post("/oauth/authorize", async (request, reply) => {
    try {
      const operatorSession = operatorSessionFromRequest(request);
      if (!operatorSession) {
        throw new OAuthProtocolError(
          "access_denied",
          "An authenticated Owner session is required",
          401
        );
      }

      const body = parseFormBody(request.body);
      const suppliedCsrf = stringField(body, "csrf_token");
      if (!suppliedCsrf || suppliedCsrf !== operatorSession.csrfToken) {
        throw new OAuthProtocolError(
          "access_denied",
          "Owner session CSRF validation failed",
          403
        );
      }

      const requestId = stringField(body, "request_id");
      const decision = stringField(body, "decision");
      if (decision === "deny") {
        const denied = service.denyAuthorizationForOwner(requestId);
        const redirect = new URL(denied.redirectUri);
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("error_description", "The owner denied this authorization request");
        if (denied.state) redirect.searchParams.set("state", denied.state);
        redirect.searchParams.set("iss", denied.issuer);
        noStore(reply);
        return reply.redirect(redirect.toString(), 303);
      }
      if (decision !== "approve") {
        throw new OAuthProtocolError(
          "invalid_request",
          "Authorization decision must be approve or deny"
        );
      }

      const result = service.approveAuthorizationForOwner(requestId);
      const redirect = new URL(result.redirectUri);
      redirect.searchParams.set("code", result.code);
      if (result.state) redirect.searchParams.set("state", result.state);
      redirect.searchParams.set("iss", result.issuer);
      noStore(reply);
      return reply.redirect(redirect.toString(), 303);
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });

  app.post("/oauth/token", async (request, reply) => {
    try {
      const body = parseFormBody(request.body);
      const grantType = stringField(body, "grant_type");
      let result;
      if (grantType === "authorization_code") {
        result = service.exchangeAuthorizationCode({
          code: stringField(body, "code"),
          clientId: stringField(body, "client_id"),
          redirectUri: stringField(body, "redirect_uri"),
          codeVerifier: stringField(body, "code_verifier"),
          resource: stringField(body, "resource")
        });
      } else if (grantType === "refresh_token") {
        result = service.refreshAccessToken({
          refreshToken: stringField(body, "refresh_token"),
          clientId: stringField(body, "client_id"),
          resource: stringField(body, "resource")
        });
      } else {
        throw new OAuthProtocolError(
          "unsupported_grant_type",
          "Only authorization_code and refresh_token are supported"
        );
      }
      noStore(reply);
      return {
        access_token: result.accessToken,
        token_type: result.tokenType,
        expires_in: result.expiresIn,
        ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
        scope: result.scope
      };
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });

  app.post("/oauth/revoke", async (request, reply) => {
    try {
      const body = parseFormBody(request.body);
      service.revokeToken(stringField(body, "token"));
      noStore(reply);
      return reply.code(200).send();
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });
}
