import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export function passkeyOriginSupported(locationLike: Pick<Location, "protocol" | "hostname"> = window.location): boolean {
  const hostname = locationLike.hostname.toLowerCase();
  if (hostname === "localhost") {
    return locationLike.protocol === "http:" || locationLike.protocol === "https:";
  }
  return locationLike.protocol === "https:" && hostname.length > 0 && !isIpLiteral(hostname);
}

export function passkeyBrowserSupported(): boolean {
  return browserSupportsWebAuthn();
}

export function passkeyClientSupported(): boolean {
  return passkeyBrowserSupported() && passkeyOriginSupported();
}
