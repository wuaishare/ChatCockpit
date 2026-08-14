import type { ProductIdentityKey } from "../types.js";
import { productIdentityForKey } from "./product-identity.js";

export interface PackageProductProjectionSource {
  name: string;
  version: string;
  bin?: string | Record<string, string>;
  [key: string]: unknown;
}

export interface PackageProductProjection extends PackageProductProjectionSource {
  bin: Record<string, string>;
}

const CLI_ENTRY = "./dist/cli/index.js";

export function projectPackageProductIdentity(
  source: Readonly<PackageProductProjectionSource>,
  productIdentity: ProductIdentityKey
): PackageProductProjection {
  const identity = productIdentityForKey(productIdentity);

  return {
    ...source,
    name: identity.packageName,
    version: source.version,
    bin: {
      [identity.cliName]: CLI_ENTRY
    }
  };
}
