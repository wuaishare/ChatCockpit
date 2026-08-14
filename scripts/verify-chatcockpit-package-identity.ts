import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { projectPackageProductIdentity } from "../src/core/package-product-projection.js";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");

const digest = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const packageDigestBefore = digest(packagePath);
const packageLockDigestBefore = digest(packageLockPath);
const rootPackage = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
  name: string;
  version: string;
  bin?: Record<string, string>;
  private?: boolean;
  [key: string]: unknown;
};
const rootPackageSnapshot = structuredClone(rootPackage);

assert.equal(rootPackage.name, "tokenpilot");
assert.equal(rootPackage.version, "0.1.0-alpha");
assert.deepEqual(rootPackage.bin, {
  tokenpilot: "./dist/cli/index.js"
});
assert.equal(rootPackage.bin?.chatcockpit, undefined);

const chatCockpitProjection = projectPackageProductIdentity(rootPackage, "chatcockpit");
assert.equal(chatCockpitProjection.name, "chatcockpit");
assert.equal(chatCockpitProjection.version, "0.1.0-alpha");
assert.deepEqual(chatCockpitProjection.bin, {
  chatcockpit: "./dist/cli/index.js"
});
assert.equal(chatCockpitProjection.bin.tokenpilot, undefined);
assert.equal(chatCockpitProjection.private, rootPackage.private);

// Projection must be pure: the caller-owned object and tracked package files stay unchanged.
assert.deepEqual(rootPackage, rootPackageSnapshot);
assert.equal(digest(packagePath), packageDigestBefore);
assert.equal(digest(packageLockPath), packageLockDigestBefore);

const futureVersionFixture = {
  ...rootPackage,
  version: "0.2.0-alpha"
};
const futureProjection = projectPackageProductIdentity(futureVersionFixture, "chatcockpit");
assert.equal(futureProjection.name, "chatcockpit");
assert.equal(futureProjection.version, "0.2.0-alpha");
assert.deepEqual(futureProjection.bin, {
  chatcockpit: "./dist/cli/index.js"
});

const tokenPilotProjection = projectPackageProductIdentity(rootPackage, "tokenpilot");
assert.equal(tokenPilotProjection.name, "tokenpilot");
assert.equal(tokenPilotProjection.version, rootPackage.version);
assert.deepEqual(tokenPilotProjection.bin, {
  tokenpilot: "./dist/cli/index.js"
});

process.stdout.write("VERIFY_CHATCOCKPIT_PACKAGE_IDENTITY_OK\n");
