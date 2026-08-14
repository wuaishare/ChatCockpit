import type { ProductIdentityKey } from "../types.js";
import { productIdentityForKey } from "./product-identity.js";

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

  if (productIdentity === "tokenpilot") return projected;

  projected = projected
    .replaceAll("TokenPilot", identity.displayName)
    .replaceAll("tokenpilot-direct", identity.builtInDirectExecutorId)
    .replaceAll("tokenpilot-runner", identity.asyncRunnerRuntimeKind)
    .replaceAll("tokenpilot-local", identity.localResourceSourceKind)
    .replaceAll("default: tokenpilot", `default: ${identity.defaultRepoId}`)
    .replaceAll("Defaults to tokenpilot", `Defaults to ${identity.defaultRepoId}`)
    .replaceAll("default repo tokenpilot", `default repo ${identity.defaultRepoId}`)
    .replaceAll(
      "current default repo tokenpilot",
      `current default repo ${identity.defaultRepoId}`
    );

  return projected;
}
