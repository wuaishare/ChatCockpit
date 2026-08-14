import type { ProductIdentityKey } from "../types.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { TokenPilotMcpTool } from "./tool-definition.js";

export function productMcpToolName(
  suffixOrLegacyName: string,
  productIdentity: ProductIdentityKey
): string {
  const identity = productIdentityForKey(productIdentity);
  const suffix = suffixOrLegacyName.startsWith("tokenpilot.")
    ? suffixOrLegacyName.slice("tokenpilot.".length)
    : suffixOrLegacyName.startsWith("chatcockpit.")
      ? suffixOrLegacyName.slice("chatcockpit.".length)
      : suffixOrLegacyName;
  return `${identity.mcpNamespace}.${suffix}`;
}

export function projectProductOwnedMcpText(
  value: string,
  productIdentity: ProductIdentityKey
): string {
  if (productIdentity === "tokenpilot") return value;
  return value
    .replaceAll("TokenPilot", "ChatCockpit")
    .replaceAll("tokenpilot.", "chatcockpit.");
}

export function projectMcpToolForProduct<T extends TokenPilotMcpTool>(
  tool: T,
  productIdentity: ProductIdentityKey
): T {
  if (productIdentity === "tokenpilot") return tool;
  return {
    ...tool,
    name: productMcpToolName(tool.name, productIdentity),
    title: projectProductOwnedMcpText(tool.title, productIdentity),
    description: projectProductOwnedMcpText(tool.description, productIdentity)
  } as T;
}

export function projectMcpToolsForProduct<T extends TokenPilotMcpTool>(
  tools: readonly T[],
  productIdentity: ProductIdentityKey
): T[] {
  return tools.map((tool) => projectMcpToolForProduct(tool, productIdentity));
}
