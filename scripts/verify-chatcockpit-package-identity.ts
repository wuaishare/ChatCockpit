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
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8")) as {
  name: string;
  version: string;
  packages?: Record<string, { name?: string; version?: string; bin?: Record<string, string> }>;
};
const rootPackageSnapshot = structuredClone(rootPackage);

assert.equal(rootPackage.name, "chatcockpit");
assert.equal(rootPackage.version, "0.2.0-alpha");
assert.deepEqual(rootPackage.bin, {
  chatcockpit: "./dist/cli/index.js"
});
assert.equal(rootPackage.bin?.tokenpilot, undefined);

assert.equal(packageLock.name, "chatcockpit");
assert.equal(packageLock.version, "0.2.0-alpha");
assert.equal(packageLock.packages?.[""]?.name, "chatcockpit");
assert.equal(packageLock.packages?.[""]?.version, "0.2.0-alpha");
assert.deepEqual(packageLock.packages?.[""]?.bin, {
  chatcockpit: "dist/cli/index.js"
});

const canonicalProjection = projectPackageProductIdentity(rootPackage, "chatcockpit");
assert.equal(canonicalProjection.name, "chatcockpit");
assert.equal(canonicalProjection.version, "0.2.0-alpha");
assert.deepEqual(canonicalProjection.bin, {
  chatcockpit: "./dist/cli/index.js"
});
assert.equal(canonicalProjection.private, rootPackage.private);

// Projection remains pure even after the target identity becomes canonical.
assert.deepEqual(rootPackage, rootPackageSnapshot);
assert.equal(digest(packagePath), packageDigestBefore);
assert.equal(digest(packageLockPath), packageLockDigestBefore);

// Historical package identity stays available only as an explicit compatibility fixture.
const legacyPackageFixture = {
  ...rootPackage,
  name: "tokenpilot",
  version: "0.1.0-alpha",
  bin: {
    tokenpilot: "./dist/cli/index.js"
  }
};
const legacyProjection = projectPackageProductIdentity(legacyPackageFixture, "tokenpilot");
assert.equal(legacyProjection.name, "tokenpilot");
assert.equal(legacyProjection.version, "0.1.0-alpha");
assert.deepEqual(legacyProjection.bin, {
  tokenpilot: "./dist/cli/index.js"
});

const migratedProjection = projectPackageProductIdentity(legacyPackageFixture, "chatcockpit");
assert.equal(migratedProjection.name, "chatcockpit");
assert.equal(migratedProjection.version, "0.1.0-alpha");
assert.deepEqual(migratedProjection.bin, {
  chatcockpit: "./dist/cli/index.js"
});

process.stdout.write("VERIFY_CHATCOCKPIT_PACKAGE_IDENTITY_OK\n");
