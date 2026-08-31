import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = "scripts/macos-manage-local-server.sh";
const source = fs.readFileSync(scriptPath, "utf8");

assert.match(source, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(source, /tokenpilot\)[\s\S]*ENV_PREFIX="TOKENPILOT"[\s\S]*STATE_DIR_NAME="\.tokenpilot"[\s\S]*SERVICE_PREFIX="com\.wuaishare\.tokenpilot"[\s\S]*Legacy TokenPilot start\/restart is disabled in R3/);
assert.match(source, /chatcockpit\)[\s\S]*ENV_PREFIX="CHATCOCKPIT"[\s\S]*STATE_DIR_NAME="\.chatcockpit"[\s\S]*SERVICE_PREFIX="com\.wuaishare\.chatcockpit"/);
assert.match(source, /ACTION.*start.*restart/s);
assert.match(source, /PROCESS_SUPERVISOR_SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.process-supervisor"/);
assert.match(source, /<string>process-supervisor<\/string>/);
assert.match(source, /write_process_supervisor_plist/);
assert.match(source, /bootstrap_process_supervisor/);
assert.match(source, /process_supervisor_ready/);
assert.match(source, /bootout_all_services/);
assert.match(source, /quiesce_legacy_tokenpilot_launch_agents/);
assert.match(source, /stop_process_supervisor_process/);
assert.match(source, /assert_packaged_runtime_ownership/);
assert.match(source, /assert_runtime_build_integrity/);
assert.match(source, /build-provenance verify --json/);
assert.match(source, /installed_runtime_ownership_matches/);
assert.match(source, /launchctl_service_pid\(\)/);
assert.match(source, /http_health_reachable\(\)/);
assert.match(source, /HTTP reachability alone is never enough/);
assert.match(source, /identity_env_value\(\)/);
assert.match(source, /variable_name="\$\{ENV_PREFIX\}_\$\{suffix\}"/);
assert.match(source, /packaged mode will not take over it automatically/i);

assert.match(source, /INSTALL_ROOT="\$\(identity_env_value INSTALL_ROOT\)"/);
assert.match(source, /INSTALL_ROOT="\$\{INSTALL_ROOT:-\$\{SCRIPT_ROOT\}\}"/);
assert.match(source, /STATE_ROOT="\$\(identity_env_value STATE_ROOT\)"/);
assert.match(source, /DISTRIBUTION_MODE.*packaged[\s\S]*STATE_ROOT="\$\{HOME\}\/Library\/Application Support\/\$\{DISPLAY_NAME\}\/state"/);
assert.match(source, /PRODUCT_IDENTITY.*chatcockpit[\s\S]*STATE_ROOT="\$\{HOME\}\/\$\{STATE_DIR_NAME\}"/);
assert.match(source, /STATE_ROOT="\$\{INSTALL_ROOT\}\/\$\{STATE_DIR_NAME\}"/);
assert.match(source, /PRIMARY_WORKSPACE_ROOT="\$\(identity_env_value PRIMARY_WORKSPACE_ROOT\)"/);
assert.match(source, /resolve_direct_node_bin\(\)/);
assert.match(source, /resolve_launchagent_codex_bin\(\)/);
assert.match(source, /dist\/runtime\/codex\/binary\.js/);
assert.match(source, /resolveCodexBinaryAsync/);
assert.match(source, /pathToFileURL/);
assert.match(source, /process\.execPath/);
assert.match(source, /NODE_BIN_CANDIDATE="\$\(identity_env_value NODE_BIN\)"/);
assert.match(source, /NODE_BIN_FALLBACK="\$\(command -v node \|\| true\)"/);
assert.match(source, /resolve_direct_node_bin "\$\{NODE_BIN_CANDIDATE\}"/);
assert.match(source, /resolve_direct_node_bin "\$\{NODE_BIN_FALLBACK\}"/);
assert.match(source, /refusing to install a wrapper command into LaunchAgent ProgramArguments/);
assert.match(source, /NODE_BIN_DIR="\$\(dirname "\$\{NODE_BIN\}"\)"/);
assert.match(
  source,
  /RUNTIME_PATH="\$\{NODE_BIN_DIR\}:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"/
);
assert.match(source, /STARTUP_READY_TIMEOUT_SECONDS="\$\(identity_env_value STARTUP_READY_TIMEOUT_SECONDS\)"/);
assert.match(source, /STARTUP_READY_TIMEOUT_SECONDS="\$\{STARTUP_READY_TIMEOUT_SECONDS:-120\}"/);
assert.match(source, /STARTUP_READY_TIMEOUT_SECONDS must be a positive integer/);
assert.match(source, /print_startup_log_tail\(\)/);
assert.match(source, /tail -n 120/);
assert.match(source, /cleanup_failed_start\(\)/);
assert.equal((source.match(/<key>PATH<\/key>/g) ?? []).length, 3);
assert.equal((source.match(/<string>\$\{RUNTIME_PATH\}<\/string>/g) ?? []).length, 3);
assert.match(source, /DISTRIBUTION_MODE="\$\(identity_env_value DISTRIBUTION_MODE\)"/);
assert.match(source, /DISTRIBUTION_MODE="\$\{DISTRIBUTION_MODE:-source\}"/);
assert.match(source, /ALLOW_HIGH_TRUST_COMMANDS="\$\(identity_env_value ALLOW_HIGH_TRUST_COMMANDS\)"/);
assert.match(source, /ALLOW_HIGH_TRUST_COMMANDS="\$\{ALLOW_HIGH_TRUST_COMMANDS:-false\}"/);
assert.equal((source.match(/<key>\$\{ENV_PREFIX\}_ALLOW_HIGH_TRUST_COMMANDS<\/key>/g) ?? []).length, 2);
assert.equal((source.match(/<string>\$\{ALLOW_HIGH_TRUST_COMMANDS\}<\/string>/g) ?? []).length, 2);
assert.match(source, /RUNTIME_DIR="\$\{STATE_ROOT\}\/runtime"/);
assert.match(source, /ACCESS_POLICY_FILE="\$\{RUNTIME_DIR\}\/access-policy\.json"/);
assert.match(source, /console_path_prefix\(\)/);
assert.match(source, /cockpit_url\(\)/);
assert.match(source, /secure_login_entry_url\(\)/);
assert.equal((source.match(/echo "Cockpit: \$\(cockpit_url\)"/g) ?? []).length, 3);
assert.equal((source.match(/echo "Secure login entry: \$\(secure_login_entry_url\)"/g) ?? []).length, 3);
assert.doesNotMatch(source, /echo "UI: \$\(console_url\)"/);
assert.match(source, /<string>\$\{NODE_BIN\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_STATE_ROOT<\/key>/);
assert.match(source, /<string>\$\{STATE_ROOT\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_PRIMARY_WORKSPACE_ROOT<\/key>/);
assert.match(source, /<string>\$\{PRIMARY_WORKSPACE_ROOT\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_DISTRIBUTION_MODE<\/key>/);
assert.match(source, /<string>\$\{DISTRIBUTION_MODE\}<\/string>/);
assert.match(source, /<string>--product-identity<\/string>[\s\S]*<string>\$\{PRODUCT_IDENTITY\}<\/string>/);

const startStart = source.indexOf("  start)\n");
const stopBoundary = source.indexOf("  stop)\n", startStart);
assert.ok(startStart >= 0 && stopBoundary > startStart);
const startBlock = source.slice(startStart, stopBoundary);
assert.match(startBlock, /assert_runtime_build_integrity/);
assert.match(startBlock, /quiesce_legacy_tokenpilot_launch_agents/);
assert.match(startBlock, /resolve_launchagent_codex_bin/);
assert.ok(
  startBlock.indexOf("resolve_launchagent_codex_bin") < startBlock.indexOf("write_server_plist"),
  "start must resolve a working Codex binary before rendering LaunchAgent plists"
);
assert.match(startBlock, /wait_for_listen "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.match(startBlock, /wait_for_runner_registration "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.match(startBlock, /wait_for_process_supervisor_ready "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.doesNotMatch(startBlock, /wait_for_(?:listen|runner_registration|process_supervisor_ready) 30/);
assert.ok(
  startBlock.indexOf("bootstrap_process_supervisor") < startBlock.indexOf("wait_for_listen"),
  "start should bring up Process Supervisor before waiting for the slower Control Plane"
);
assert.match(startBlock, /cleanup_failed_start/);
assert.match(startBlock, /cleaning up managed services/);

const restartStart = source.indexOf("  restart)\n");
const statusStart = source.indexOf("  status)\n", restartStart);
assert.ok(restartStart >= 0 && statusStart > restartStart);
const restartBlock = source.slice(restartStart, statusStart);
assert.match(restartBlock, /assert_runtime_build_integrity/);
assert.match(restartBlock, /quiesce_legacy_tokenpilot_launch_agents/);
assert.match(restartBlock, /resolve_launchagent_codex_bin/);
assert.ok(
  restartBlock.indexOf("resolve_launchagent_codex_bin") < restartBlock.indexOf("write_server_plist"),
  "restart must resolve a working Codex binary before rendering LaunchAgent plists"
);
assert.match(restartBlock, /kickstart_control_plane_and_runner/);
assert.match(restartBlock, /launchctl_process_supervisor_registered/);
assert.doesNotMatch(restartBlock, /bootout_process_supervisor/);
assert.doesNotMatch(
  restartBlock,
  /kickstart\s+-k\s+"\$\{USER_DOMAIN\}\/\$\{PROCESS_SUPERVISOR_SERVICE_LABEL\}"/
);
assert.doesNotMatch(restartBlock, /bootout_all_services/);
assert.doesNotMatch(restartBlock, /"\$\{0\}"\s+stop/);
assert.match(restartBlock, /wait_for_listen "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.match(restartBlock, /wait_for_runner_registration "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.match(restartBlock, /wait_for_process_supervisor_ready "\$\{STARTUP_READY_TIMEOUT_SECONDS\}"/);
assert.doesNotMatch(restartBlock, /wait_for_(?:listen|runner_registration|process_supervisor_ready) 30/);
assert.match(restartBlock, /print_startup_log_tail/);

const legacyQuiesceStart = source.indexOf("quiesce_legacy_tokenpilot_launch_agents() {");
const bootstrapStart = source.indexOf("bootstrap_control_plane_and_runner() {", legacyQuiesceStart);
assert.ok(legacyQuiesceStart >= 0 && bootstrapStart > legacyQuiesceStart);
const legacyQuiesceBlock = source.slice(legacyQuiesceStart, bootstrapStart);
assert.match(legacyQuiesceBlock, /com\.wuaishare\.tokenpilot\.control-plane/);
assert.match(legacyQuiesceBlock, /com\.wuaishare\.tokenpilot\.runner/);
assert.match(legacyQuiesceBlock, /com\.wuaishare\.tokenpilot\.process-supervisor/);
assert.match(legacyQuiesceBlock, /launchctl bootout/);
assert.match(legacyQuiesceBlock, /launchctl disable/);
assert.match(legacyQuiesceBlock, /rm -f/);

const stopStart = source.indexOf("  stop)\n");
const restartBoundary = source.indexOf("  restart)\n", stopStart);
const stopBlock = source.slice(stopStart, restartBoundary);
assert.match(stopBlock, /assert_packaged_runtime_ownership/);
assert.match(stopBlock, /bootout_all_services/);
assert.match(stopBlock, /stop_process_supervisor_process/);

const stopPortStart = source.indexOf("stop_port_process() {");
const stopRunnerStart = source.indexOf("stop_runner_process() {", stopPortStart);
assert.ok(stopPortStart >= 0 && stopRunnerStart > stopPortStart);
const stopPortBlock = source.slice(stopPortStart, stopRunnerStart);
assert.match(stopPortBlock, /DISTRIBUTION_MODE.*packaged/s);
assert.match(stopPortBlock, /PID_FILE/);
assert.match(stopPortBlock, /preserving foreign listener/i);

const uninstallStart = source.indexOf("  reset\|uninstall)\n");
assert.ok(uninstallStart >= 0);
const uninstallBlock = source.slice(uninstallStart);
assert.match(uninstallBlock, /bootout_all_services/);
assert.match(uninstallBlock, /remove_installed_plists/);
assert.match(uninstallBlock, /PROCESS_SUPERVISOR_PLIST_FILE/);

const removeInstalledStart = source.indexOf("remove_installed_plists() {");
const bootoutStart = source.indexOf("bootout_control_plane_and_runner() {", removeInstalledStart);
assert.ok(removeInstalledStart >= 0 && bootoutStart > removeInstalledStart);
const removeInstalledBlock = source.slice(removeInstalledStart, bootoutStart);
assert.match(removeInstalledBlock, /INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE/);

const invalidTimeoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-macos-startup-timeout-"));
try {
  const invalidTimeout = spawnSync(
    "bash",
    [scriptPath, "status"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: invalidTimeoutRoot,
        CHATCOCKPIT_INSTALL_ROOT: process.cwd(),
        CHATCOCKPIT_STATE_ROOT: path.join(invalidTimeoutRoot, "state"),
        CHATCOCKPIT_STARTUP_READY_TIMEOUT_SECONDS: "0"
      }
    }
  );
  assert.equal(invalidTimeout.status, 2, invalidTimeout.stderr || invalidTimeout.stdout);
  assert.match(invalidTimeout.stderr, /STARTUP_READY_TIMEOUT_SECONDS must be a positive integer/);
} finally {
  fs.rmSync(invalidTimeoutRoot, { recursive: true, force: true });
}

const fallbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-macos-health-fallback-"));
try {
  const binDir = path.join(fallbackRoot, "bin");
  const stateRoot = path.join(fallbackRoot, "legacy-state");
  const homeRoot = path.join(fallbackRoot, "home");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(homeRoot, { recursive: true });
  const writeExecutable = (name: string, content: string) => {
    const filePath = path.join(binDir, name);
    fs.writeFileSync(filePath, content, { mode: 0o755 });
    fs.chmodSync(filePath, 0o755);
  };
  writeExecutable(
    "lsof",
    `#!/bin/sh\nexit 0\n`
  );
  writeExecutable(
    "curl",
    `#!/bin/sh\nprintf '%s\\n' '{"ok":true}'\n`
  );
  writeExecutable(
    "launchctl",
    `#!/bin/sh\ncase "$*" in\n  *process-supervisor*) exit 1 ;;\n  *control-plane*|*runner*)\n    if [ "$1" = "print" ]; then\n      printf 'state = running\\npid = %s\\n' "$MOCK_LAUNCH_PID"\n    fi\n    exit 0\n    ;;\n  *) exit 0 ;;\nesac\n`
  );

  const fallback = spawnSync(
    "bash",
    [scriptPath, "status", "--product-identity", "tokenpilot"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeRoot,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        MOCK_LAUNCH_PID: String(process.pid),
        TOKENPILOT_INSTALL_ROOT: process.cwd(),
        TOKENPILOT_STATE_ROOT: stateRoot,
        TOKENPILOT_CONFIG_PATH: path.join(homeRoot, ".tokenpilot", "config.json"),
        TOKENPILOT_DISTRIBUTION_MODE: "source"
      }
    }
  );
  assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
  assert.match(fallback.stdout, new RegExp(`control plane: running \\(pid ${process.pid}\\)`));
  assert.equal(fs.readFileSync(path.join(stateRoot, "runtime", "server.pid"), "utf8").trim(), String(process.pid));
} finally {
  fs.rmSync(fallbackRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_MACOS_LOCAL_SERVICES_OK\n");
