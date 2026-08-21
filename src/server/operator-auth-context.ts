import type { FastifyRequest } from "fastify";

import type { OperatorSessionContext } from "../auth/operator-service.js";

export const OPERATOR_SESSION_COOKIE = "chatcockpit_operator_session";
export const OPERATOR_CSRF_HEADER = "x-chatcockpit-csrf";
export const OPERATOR_LOGIN_GATE_HEADER = "x-chatcockpit-login-gate";

export type RequestAuthContext =
  | { kind: "anonymous" }
  | { kind: "machine-bearer" }
  | { kind: "operator-session"; session: OperatorSessionContext }
  | {
      kind: "mcp-oauth";
      authorizationGrantId: string;
      clientRegistrationId: string;
    };

declare module "fastify" {
  interface FastifyRequest {
    chatCockpitAuth: RequestAuthContext;
  }
}

export function parseCookieHeader(value: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!value) return cookies;
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookie values rather than broadening auth behavior.
    }
  }
  return cookies;
}

export function readOperatorSessionCookie(request: FastifyRequest): string | null {
  return parseCookieHeader(request.headers.cookie).get(OPERATOR_SESSION_COOKIE) ?? null;
}

export function readOperatorLoginGate(request: FastifyRequest): string | null {
  const value = request.headers[OPERATOR_LOGIN_GATE_HEADER];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === "string" ? value.trim() || null : null;
}

export function operatorSessionFromRequest(
  request: FastifyRequest
): OperatorSessionContext | null {
  return request.chatCockpitAuth.kind === "operator-session"
    ? request.chatCockpitAuth.session
    : null;
}
