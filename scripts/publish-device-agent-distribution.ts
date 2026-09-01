import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ARCHITECTURES = ["arm64", "x64"] as const;
type Architecture = (typeof ARCHITECTURES)[number];

interface PackageManifest {
  schemaVersion: number;
  productIdentity: string;
  packageKind: string;
  version: string;
  platform: string;
  architecture: Architecture;
  distributionTrust: string;
  releaseEligible: boolean;
  runtime: {
    runtimeId: string;
    nodeVersion: string | null;
  };
}

interface BuildProvenance {
  buildId: string;
  revision: string;
  builtAt: string;
  sourceDirty: boolean;
}

interface DistributionArtifact {
  architecture: Architecture;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  packageManifestSha256: string;
  runtimeId: string;
  nodeVersion: string;
  build: {
    buildId: string;
    revision: string;
    builtAt: string;
  };
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requireRegularFile(filePath: string, label: string): void {
  assert(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile(), `${label} is not a regular file: ${filePath}`);
  assert(!stat.isSymbolicLink(), `${label} must not be a symlink: ${filePath}`);
}

function packagePaths(root: string, architecture: Architecture, version: string) {
  const base = path.join(root, "dist", "device-agent", "macos", architecture);
  const archiveName = `ChatCockpit-Device-Agent-${version}-macos-${architecture}.tar.gz`;
  return {
    base,
    archiveName,
    archivePath: path.join(base, archiveName),
    checksumPath: path.join(base, `${archiveName}.sha256`),
    packageManifestPath: path.join(base, "ChatCockpitDeviceAgent", "manifest.json"),
    buildProvenancePath: path.join(
      base,
      "ChatCockpitDeviceAgent",
      "runtime",
      "TokenPilotRuntime",
      "app",
      "dist",
      "build-provenance.json"
    )
  };
}

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  version?: string;
};
const version = String(packageJson.version ?? "").trim();
assert(version, "package version is missing");

const outputDir = path.resolve(
  process.env.CHATCOCKPIT_DEVICE_AGENT_DISTRIBUTION_OUTPUT_DIR ??
    path.join(root, "dist", "device-agent", "distribution")
);
const stagingDir = `${outputDir}.staging-${process.pid}`;
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

try {
  const artifacts = {} as Record<Architecture, DistributionArtifact>;

  for (const architecture of ARCHITECTURES) {
    const paths = packagePaths(root, architecture, version);
    requireRegularFile(paths.archivePath, `${architecture} release archive`);
    requireRegularFile(paths.checksumPath, `${architecture} archive checksum`);
    requireRegularFile(paths.packageManifestPath, `${architecture} package manifest`);
    requireRegularFile(paths.buildProvenancePath, `${architecture} build provenance`);

    const packageManifest = JSON.parse(
      fs.readFileSync(paths.packageManifestPath, "utf8")
    ) as PackageManifest;
    assert.equal(packageManifest.schemaVersion, 1);
    assert.equal(packageManifest.productIdentity, "chatcockpit");
    assert.equal(packageManifest.packageKind, "device-agent-portable");
    assert.equal(packageManifest.version, version);
    assert.equal(packageManifest.platform, "darwin");
    assert.equal(packageManifest.architecture, architecture);
    assert.equal(packageManifest.distributionTrust, "release");
    assert.equal(packageManifest.releaseEligible, true);
    assert(packageManifest.runtime.runtimeId?.trim(), `${architecture} runtime id is missing`);
    assert(packageManifest.runtime.nodeVersion?.trim(), `${architecture} bundled Node version is missing`);

    const provenance = JSON.parse(
      fs.readFileSync(paths.buildProvenancePath, "utf8")
    ) as BuildProvenance;
    assert.equal(provenance.sourceDirty, false, `${architecture} package provenance is dirty`);
    assert(provenance.buildId?.trim(), `${architecture} package build id is missing`);
    assert(provenance.revision?.trim(), `${architecture} package revision is missing`);
    assert(provenance.builtAt?.trim(), `${architecture} package build timestamp is missing`);

    const checksumLine = fs.readFileSync(paths.checksumPath, "utf8").trim();
    const checksumMatch = /^([a-f0-9]{64})\s{2}([^/]+)$/.exec(checksumLine);
    assert(checksumMatch, `${architecture} checksum file is malformed`);
    const [, declaredSha256, declaredName] = checksumMatch;
    assert.equal(declaredName, paths.archiveName);
    const actualSha256 = sha256File(paths.archivePath);
    assert.equal(actualSha256, declaredSha256, `${architecture} archive checksum mismatch`);

    const destinationPath = path.join(stagingDir, paths.archiveName);
    fs.copyFileSync(paths.archivePath, destinationPath);
    assert.equal(
      sha256File(destinationPath),
      actualSha256,
      `${architecture} copied archive checksum mismatch`
    );

    artifacts[architecture] = {
      architecture,
      fileName: paths.archiveName,
      sha256: actualSha256,
      sizeBytes: fs.statSync(destinationPath).size,
      packageManifestSha256: sha256File(paths.packageManifestPath),
      runtimeId: packageManifest.runtime.runtimeId,
      nodeVersion: packageManifest.runtime.nodeVersion,
      build: {
        buildId: provenance.buildId,
        revision: provenance.revision,
        builtAt: provenance.builtAt
      }
    };
  }

  assert.equal(
    artifacts.arm64.build.revision,
    artifacts.x64.build.revision,
    "arm64/x64 release artifacts must come from the same source revision"
  );
  assert.equal(
    artifacts.arm64.nodeVersion,
    artifacts.x64.nodeVersion,
    "arm64/x64 release artifacts must embed the same Node version"
  );

  const manifest = {
    schemaVersion: 1,
    productIdentity: "chatcockpit",
    packageKind: "device-agent-distribution",
    version,
    platform: "darwin",
    distributionTrust: "release",
    releaseEligible: true,
    architectures: artifacts
  };
  const manifestPath = path.join(stagingDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestSha256 = sha256File(manifestPath);
  fs.writeFileSync(
    path.join(stagingDir, "manifest.json.sha256"),
    `${manifestSha256}  manifest.json\n`,
    "utf8"
  );

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.renameSync(stagingDir, outputDir);
  console.log(`DEVICE_AGENT_DISTRIBUTION_PUBLISHED ${path.relative(root, outputDir)}`);
  console.log(`manifest sha256: ${manifestSha256}`);
} catch (error) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  throw error;
}
