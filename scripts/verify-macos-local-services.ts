import assert from "node:assert/strict";
import fs from "node:fs";

const scriptPath = "scripts/macos-manage-local-server.sh";
const source = fs.readFileSync(scriptPath, "utf8");

assert.match(source, /com\.wuaishare\.tokenpilot\.process-supervisor/);
assert.match(source, /<string>process-supervisor<\/string>/);
assert.match(source, /write_process_supervisor_plist/);
assert.match(source, /bootstrap_process_supervisor/);
assert.match(source, /process_supervisor_ready/);
assert.match(source, /bootout_all_services/);
assert.match(source, /stop_process_supervisor_process/);
assert.match(source, /assert_packaged_runtime_ownership/);
assert.match(source, /installed_runtime_ownership_matches/);
assert.match(source, /TOKENPILOT_DISTRIBUTION_MODE/);
assert.match(source, /TOKENPILOT_INSTALL_ROOT/);
assert.match(source, /packaged mode will not take over it automatically/i);

assert.match(source, /INSTALL_ROOT="\$\{TOKENPILOT_INSTALL_ROOT:-\$\{SCRIPT_ROOT\}\}"/);
assert.match(source, /STATE_ROOT="\$\{TOKENPILOT_STATE_ROOT:-\$\{INSTALL_ROOT\}\/\.tokenpilot\}"/);
assert.match(source, /PRIMARY_WORKSPACE_ROOT="\$\{TOKENPILOT_PRIMARY_WORKSPACE_ROOT:-\$\{INSTALL_ROOT\}\}"/);
assert.match(source, /NODE_BIN="\$\{TOKENPILOT_NODE_BIN:-\$\(command -v node\)\}"/);
assert.match(source, /DISTRIBUTION_MODE="\$\{TOKENPILOT_DISTRIBUTION_MODE:-source\}"/);
assert.match(source, /RUNTIME_DIR="\$\{STATE_ROOT\}\/runtime"/);
assert.match(source, /<string>\$\{NODE_BIN\}<\/string>/);
assert.match(source, /<key>TOKENPILOT_STATE_ROOT<\/key>/);
assert.match(source, /<string>\$\{STATE_ROOT\}<\/string>/);
assert.match(source, /<key>TOKENPILOT_PRIMARY_WORKSPACE_ROOT<\/key>/);
assert.match(source, /<string>\$\{PRIMARY_WORKSPACE_ROOT\}<\/string>/);
assert.match(source, /<key>TOKENPILOT_DISTRIBUTION_MODE<\/key>/);
assert.match(source, /<string>\$\{DISTRIBUTION_MODE\}<\/string>/);

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
