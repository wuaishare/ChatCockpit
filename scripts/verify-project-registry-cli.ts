import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  runGit(["-C", repoPath, "add", "README.md"]);
  runGit([
    "-C",
    repoPath,
    "-c",
    "user.name=ChatCockpit Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture"
  ]);
}

function runCli(home: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHATCOCKPIT_DISTRIBUTION_MODE: "packaged",
      CHATCOCKPIT_INSTALL_ROOT: repoRoot,
      CHATCOCKPIT_STATE_ROOT: path.join(home, "state"),
      CHATCOCKPIT_CONFIG_PATH: path.join(home, "config", "config.json"),
      CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: home,
      CHATCOCKPIT_EXPOSED: "false",
      CHATCOCKPIT_API_TOKEN: ""
    },
    encoding: "utf8"
  });
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

interface RegistryList {
  ok: true;
  initialized: boolean;
  configRevision: string | null;
  projects: Array<{
    project: {
      id: string;
      slug: string;
      displayName: string;
      defaultWorkspaceId: string | null;
    };
    roots: Array<{
      id: string;
      role: string;
      access: string;
      primary: boolean;
      privatePath: string;
      executionWorkspaceIds: string[];
    }>;
    workspaces: Array<{ id: string; repoId: string }>;
  }>;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-registry-cli-"));
const gitRoot = path.join(home, "projects", "alpha");
const docsRoot = path.join(home, "projects", "alpha-docs");
initRepo(gitRoot);
fs.mkdirSync(docsRoot, { recursive: true });

try {
  const configPath = path.join(home, "config", "config.json");

  let result = runCli(home, ["project-registry", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  let listed = parseJson<RegistryList>(result.stdout);
  assert.equal(listed.initialized, false);
  assert.equal(listed.configRevision, null);
  assert.deepEqual(listed.projects, []);
  assert.equal(fs.existsSync(configPath), false, "read-only list must not initialize config");

  result = runCli(home, [
    "project-registry", "create",
    "--slug", "alpha",
    "--display-name", "Alpha",
    "--path", gitRoot,
    "--kind", "git-repository",
    "--repo-id", "alpha",
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const created = parseJson<{ ok: true; configRevision: string; project: { id: string } }>(result.stdout);
  assert.match(created.configRevision, /^[a-f0-9]{64}$/);

  result = runCli(home, ["project-registry", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  listed = parseJson<RegistryList>(result.stdout);
  assert.equal(listed.initialized, true);
  assert.equal(listed.projects.length, 1);
  const project = listed.projects[0]!;
  const initialDefaultWorkspaceId = project.project.defaultWorkspaceId;
  assert.ok(initialDefaultWorkspaceId);
  assert.equal(project.project.slug, "alpha");
  assert.equal(project.project.displayName, "Alpha");
  assert.equal(project.workspaces.length, 1);
  assert.equal(project.workspaces[0]?.repoId, "alpha");
  assert.equal(project.roots.length, 1);
  assert.equal(project.roots[0]?.privatePath, fs.realpathSync.native(gitRoot));
  assert.equal(project.roots[0]?.primary, true);

  result = runCli(home, [
    "project-registry", "add-root",
    "--project-id", project.project.id,
    "--path", docsRoot,
    "--kind", "directory",
    "--role", "documentation",
    "--access", "read-only",
    "--expected-revision", listed.configRevision!,
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const attached = parseJson<{ ok: true; configRevision: string }>(result.stdout);
  assert.notEqual(attached.configRevision, listed.configRevision);

  result = runCli(home, ["project-registry", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  listed = parseJson<RegistryList>(result.stdout);
  const withDocs = listed.projects[0]!;
  const docs = withDocs.roots.find((root) => root.role === "documentation");
  assert.ok(docs);
  assert.equal(docs.access, "read-only");
  assert.deepEqual(docs.executionWorkspaceIds, []);

  result = runCli(home, [
    "project-registry", "make-primary-root",
    "--project-id", withDocs.project.id,
    "--root-id", docs.id,
    "--expected-revision", listed.configRevision!,
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);

  result = runCli(home, ["project-registry", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  listed = parseJson<RegistryList>(result.stdout);
  const finalProject = listed.projects[0]!;
  assert.equal(finalProject.roots.find((root) => root.id === docs.id)?.primary, true);
  assert.equal(finalProject.project.defaultWorkspaceId, initialDefaultWorkspaceId);

  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  assert.equal(rawConfig.schemaVersion, 3);
  assert.equal("repoMappings" in rawConfig, false);
  assert.equal("defaultRepoId" in rawConfig, false);

  process.stdout.write("VERIFY_PROJECT_REGISTRY_CLI_OK\n");
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
