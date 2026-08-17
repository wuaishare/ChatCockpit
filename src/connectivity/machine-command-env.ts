import path from "node:path";

const STANDARD_MACOS_LOCAL_BINARIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

export function connectivityMachinePath(currentPath = process.env.PATH ?? ""): string {
  const current = currentPath.split(path.delimiter).filter(Boolean);
  return [...new Set([...current, ...STANDARD_MACOS_LOCAL_BINARIES])].join(path.delimiter);
}
