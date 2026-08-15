import type { ProductIdentityKey } from "../types.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "./product-identity.js";

export function projectOpenApiForProduct(
  source: string,
  productIdentity: ProductIdentityKey,
  serverUrl: string
): string {
  const identity = productIdentityForKey(productIdentity);
  let projected = source.replace(
    /^servers:\n  - url: .+$/m,
    `servers:\n  - url: ${serverUrl}`
  );

  if (productIdentity === DEFAULT_PRODUCT_IDENTITY.key) return projected;

  projected = projected
    .replaceAll("ChatCockpit", identity.displayName)
    .replaceAll("CHATCOCKPIT_", `${identity.envPrefix}_`)
    .replaceAll("builtin-direct", identity.builtInDirectExecutorId)
    .replaceAll("async-runner", identity.asyncRunnerRuntimeKind)
    .replaceAll("control-plane-local", identity.localResourceSourceKind)
    .replaceAll("default: primary", `default: ${identity.defaultRepoId}`)
    .replaceAll("Defaults to primary", `Defaults to ${identity.defaultRepoId}`)
    .replaceAll("default repo primary", `default repo ${identity.defaultRepoId}`)
    .replaceAll(
      "current default repo primary",
      `current default repo ${identity.defaultRepoId}`
    );

  return projected;
}
