const DEFAULT_CONSOLE_BASE_PATH = "/ui";

function normalizeConsoleBasePath(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed.startsWith("/") || trimmed === "/") {
    return DEFAULT_CONSOLE_BASE_PATH;
  }
  return trimmed.replace(/\/+$/, "") || DEFAULT_CONSOLE_BASE_PATH;
}

export function getConsoleBasePath(): string {
  if (typeof document === "undefined") return DEFAULT_CONSOLE_BASE_PATH;
  const configured = document
    .querySelector<HTMLMetaElement>('meta[name="chatcockpit-console-base"]')
    ?.content;
  return normalizeConsoleBasePath(configured);
}

export const CONSOLE_BASE_PATH = getConsoleBasePath();

export function consolePath(suffix = ""): string {
  const normalizedSuffix = suffix.trim().replace(/^\/+/, "");
  return normalizedSuffix
    ? `${CONSOLE_BASE_PATH}/${normalizedSuffix}`
    : CONSOLE_BASE_PATH;
}

export function stripConsoleBasePath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || CONSOLE_BASE_PATH;
  if (normalized === CONSOLE_BASE_PATH) return "";
  if (!normalized.startsWith(`${CONSOLE_BASE_PATH}/`)) return null;
  return normalized.slice(CONSOLE_BASE_PATH.length + 1);
}
