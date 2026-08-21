import type { FastifyInstance } from "fastify";

const BASE_CONTENT_SECURITY_POLICY_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'"
] as const;

function normalizeFormActionOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.origin !== value ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    throw new Error("CSP form-action entries must be HTTP(S) origins");
  }
  return parsed.origin;
}

export function buildContentSecurityPolicy(
  formActionOrigins: readonly string[] = []
): string {
  const formActions = [
    "'self'",
    ...new Set(formActionOrigins.map(normalizeFormActionOrigin))
  ];
  return [
    ...BASE_CONTENT_SECURITY_POLICY_DIRECTIVES,
    `form-action ${formActions.join(" ")}`,
    "frame-ancestors 'none'"
  ].join("; ");
}

const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy();

const LOOPBACK_V4 = /^127(?:\.(?:\d{1,3})){3}$/;
const MAPPED_LOOPBACK_V4 = /^::ffff:(127(?:\.(?:\d{1,3})){3})$/i;

function validIpv4Octets(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

export function isLoopbackProxyAddress(address: string): boolean {
  const normalized = address.trim();
  if (normalized === "::1") return true;
  if (LOOPBACK_V4.test(normalized)) {
    return validIpv4Octets(normalized);
  }
  const mapped = MAPPED_LOOPBACK_V4.exec(normalized)?.[1];
  return mapped ? validIpv4Octets(mapped) : false;
}

export function trustLoopbackProxy(address: string): boolean {
  return isLoopbackProxyAddress(address);
}

export function registerWebSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    if (!reply.hasHeader("content-security-policy")) {
      reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
    }
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()"
    );
    reply.header("cross-origin-opener-policy", "same-origin");

    if (request.protocol === "https") {
      reply.header(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains"
      );
    }
  });
}
