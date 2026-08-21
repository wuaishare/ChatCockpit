import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildDistributionContext } from "../src/core/distribution-context.js";
import { buildPaths } from "../src/core/paths.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-service-"));
try {
  const installRoot = path.join(root, "install");
  const stateRoot = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const context = buildDistributionContext({
    productIdentity: "chatcockpit",
    mode: "packaged",
    installRoot,
    stateRoot,
    primaryWorkspaceRoot: workspaceRoot,
    nodeExecutable: "/opt/chatcockpit/runtime/node/bin/node",
    configPath: path.join(stateRoot, "config.json")
  });
  const paths = buildPaths(context);

  assert.equal(
    path.basename(paths.deviceAgentPlistPath),
    "com.wuaishare.chatcockpit.device-agent.plist"
  );
  assert.equal(path.basename(paths.deviceAgentPidPath), "device-agent.pid");
  assert.equal(path.basename(paths.deviceAgentLogPath), "device-agent.log");
  assert.notEqual(paths.deviceAgentPlistPath, paths.runnerPlistPath);
  assert.notEqual(paths.deviceAgentPlistPath, paths.processSupervisorPlistPath);

  const helperPath = "scripts/macos-manage-device-agent.sh";
  assert.equal(fs.existsSync(helperPath), true, "Device Agent launchd helper must exist");
  const helper = fs.readFileSync(helperPath, "utf8");
  assert.match(helper, /SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.device-agent"/);
  assert.match(helper, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(helper, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(
    helper,
    /<string>\$\{NODE_BIN\}<\/string>[\s\S]*<string>\$\{INSTALL_ROOT\}\/dist\/cli\/index\.js<\/string>[\s\S]*<string>device<\/string>[\s\S]*<string>agent<\/string>[\s\S]*<string>--json<\/string>/
  );
  assert.doesNotMatch(helper, /eval\s/);
  assert.doesNotMatch(helper, /bash\s+-c/);
  assert.doesNotMatch(helper, /sh\s+-c/);
  assert.doesNotMatch(helper, /COMMAND|EXECUTABLE|SCRIPT_PATH/);

  const runtimeHelper = fs.readFileSync("scripts/macos-manage-local-server.sh", "utf8");
  for (const [name, start, end] of [
    ["stop", "  stop)\n", "  restart)\n"],
    ["restart", "  restart)\n", "  status)\n"],
    ["reset", "  reset|uninstall)\n", "  *)\n"]
  ] as const) {
    const from = runtimeHelper.indexOf(start);
    const to = runtimeHelper.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Runtime helper ${name} block must be discoverable`);
    const block = runtimeHelper.slice(from, to);
    assert.doesNotMatch(
      block,
      /device-agent|DEVICE_AGENT_SERVICE_LABEL|INSTALLED_DEVICE_AGENT_PLIST_FILE/,
      `Runtime ${name} must not stop or mutate the independent Device Agent service`
    );
  }

  const payloadBuilder = fs.readFileSync("scripts/build-macos-runtime-payload.sh", "utf8");
  assert.match(payloadBuilder, /macos-manage-device-agent\.sh/);

  process.stdout.write("VERIFY_MACOS_DEVICE_AGENT_SERVICE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
