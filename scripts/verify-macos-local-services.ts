import assert from "node:assert/strict";
import fs from "node:fs";

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
assert.match(source, /stop_process_supervisor_process/);
assert.match(source, /assert_packaged_runtime_ownership/);
assert.match(source, /installed_runtime_ownership_matches/);
assert.match(source, /identity_env_value\(\)/);
assert.match(source, /variable_name="\$\{ENV_PREFIX\}_\$\{suffix\}"/);
assert.match(source, /packaged mode will not take over it automatically/i);

assert.match(source, /INSTALL_ROOT="\$\(identity_env_value INSTALL_ROOT\)"/);
assert.match(source, /INSTALL_ROOT="\$\{INSTALL_ROOT:-\$\{SCRIPT_ROOT\}\}"/);
assert.match(source, /STATE_ROOT="\$\(identity_env_value STATE_ROOT\)"/);
assert.match(source, /STATE_ROOT="\$\{STATE_ROOT:-\$\{INSTALL_ROOT\}\/\$\{STATE_DIR_NAME\}\}"/);
assert.match(source, /PRIMARY_WORKSPACE_ROOT="\$\(identity_env_value PRIMARY_WORKSPACE_ROOT\)"/);
assert.match(source, /NODE_BIN="\$\(identity_env_value NODE_BIN\)"/);
assert.match(source, /DISTRIBUTION_MODE="\$\(identity_env_value DISTRIBUTION_MODE\)"/);
assert.match(source, /DISTRIBUTION_MODE="\$\{DISTRIBUTION_MODE:-source\}"/);
assert.match(source, /RUNTIME_DIR="\$\{STATE_ROOT\}\/runtime"/);
assert.match(source, /<string>\$\{NODE_BIN\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_STATE_ROOT<\/key>/);
assert.match(source, /<string>\$\{STATE_ROOT\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_PRIMARY_WORKSPACE_ROOT<\/key>/);
assert.match(source, /<string>\$\{PRIMARY_WORKSPACE_ROOT\}<\/string>/);
assert.match(source, /<key>\$\{ENV_PREFIX\}_DISTRIBUTION_MODE<\/key>/);
assert.match(source, /<string>\$\{DISTRIBUTION_MODE\}<\/string>/);
assert.match(source, /<string>--product-identity<\/string>[\s\S]*<string>\$\{PRODUCT_IDENTITY\}<\/string>/);

const restartStart = source.indexOf("  restart)\n");
const statusStart = source.indexOf("  status)\n", restartStart);
assert.ok(restartStart >= 0 && statusStart > restartStart);
const restartBlock = source.slice(restartStart, statusStart);
assert.match(restartBlock, /kickstart_control_plane_and_runner/);
assert.match(restartBlock, /launchctl_process_supervisor_registered/);
assert.doesNotMatch(restartBlock, /bootout_process_supervisor/);
assert.doesNotMatch(
  restartBlock,
  /kickstart\s+-k\s+"\$\{USER_DOMAIN\}\/\$\{PROCESS_SUPERVISOR_SERVICE_LABEL\}"/
);
assert.doesNotMatch(restartBlock, /bootout_all_services/);
assert.doesNotMatch(restartBlock, /"\$\{0\}"\s+stop/);

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

process.stdout.write("VERIFY_MACOS_LOCAL_SERVICES_OK\n");
