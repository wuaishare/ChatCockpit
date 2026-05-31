import path from "node:path";

export function isPathInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return (
    relative === "" ||
    (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function normalizeRelativeInput(relativeInput: string, label: string): string {
  if (!relativeInput || typeof relativeInput !== "string") {
    throw new Error(`${label} must be a non-empty relative path`);
  }

  if (path.isAbsolute(relativeInput)) {
    throw new Error(`${label} must be a relative path`);
  }

  if (relativeInput.includes("\\")) {
    throw new Error(`${label} must not contain backslash path separators`);
  }

  const normalized = path.posix.normalize(relativeInput).replace(/^\.\/+/, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`${label} must stay within the repository root`);
  }

  return normalized || ".";
}

export function resolvePathInsideRoot(
  root: string,
  relativeInput: string,
  label: string
): { absolutePath: string; relativePath: string } {
  const relativePath = normalizeRelativeInput(relativeInput, label);
  const absolutePath = path.resolve(root, relativePath);

  if (!isPathInsideRoot(root, absolutePath)) {
    throw new Error(`${label} must stay within the repository root`);
  }

  return { absolutePath, relativePath };
}
