const MAX_ROUTER_TEXT_BYTES = 64 * 1024;
const MAX_ROUTER_STRUCTURED_BYTES = 64 * 1024;

export interface CapabilityRouterResultProjection {
  isError: boolean;
  text: string;
  structuredContent: Record<string, unknown> | null;
  truncated: boolean;
  omittedContentBlocks: number;
}

function boundedText(value: string, maxBytes: number): {
  value: string;
  truncated: boolean;
} {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) {
    return { value, truncated: false };
  }
  const clipped = bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
  return { value: clipped, truncated: true };
}

function boundedStructuredContent(
  value: unknown
): { value: Record<string, unknown> | null; truncated: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: null, truncated: value !== undefined && value !== null };
  }
  try {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > MAX_ROUTER_STRUCTURED_BYTES) {
      return { value: null, truncated: true };
    }
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { value: parsed as Record<string, unknown>, truncated: false }
      : { value: null, truncated: true };
  } catch {
    return { value: null, truncated: true };
  }
}

export function projectCapabilityRouterResult(
  result: unknown
): CapabilityRouterResultProjection {
  const record =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const textParts: string[] = [];
  let remainingBytes = MAX_ROUTER_TEXT_BYTES;
  let truncated = false;
  let omittedContentBlocks = 0;

  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      omittedContentBlocks += 1;
      truncated = true;
      continue;
    }
    const entry = block as Record<string, unknown>;
    if (entry.type !== "text" || typeof entry.text !== "string") {
      omittedContentBlocks += 1;
      truncated = true;
      continue;
    }
    if (remainingBytes <= 0) {
      truncated = true;
      continue;
    }
    const bounded = boundedText(entry.text, remainingBytes);
    textParts.push(bounded.value);
    remainingBytes -= Buffer.byteLength(bounded.value, "utf8");
    truncated ||= bounded.truncated;
  }

  const structured = boundedStructuredContent(record.structuredContent);
  truncated ||= structured.truncated;

  return {
    isError: record.isError === true,
    text: textParts.join("\n"),
    structuredContent: structured.value,
    truncated,
    omittedContentBlocks
  };
}

export type CapabilityRouterReadResultProjection = CapabilityRouterResultProjection;
export const projectCapabilityRouterReadResult = projectCapabilityRouterResult;
