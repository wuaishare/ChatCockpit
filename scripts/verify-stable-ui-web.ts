import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const consolePath = fs.readFileSync(path.join(root, "web", "src", "console-path.ts"), "utf8");
const api = fs.readFileSync(path.join(root, "web", "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

assert.match(consolePath, /DEFAULT_CONSOLE_BASE_PATH\s*=\s*"\/ui"/);
assert.doesNotMatch(
  consolePath,
  /querySelector<[^>]*>\('meta\[name="chatcockpit-console-base"\]'\)/,
  "browser navigation must not derive its canonical base from a secret meta path"
);
assert.match(consolePath, /CONSOLE_BASE_PATH\s*=\s*DEFAULT_CONSOLE_BASE_PATH/);

assert.doesNotMatch(
  api,
  /X-ChatCockpit-Console-Path/,
  "ordinary browser API calls must not propagate the legacy secret console path"
);
assert.match(api, /X-ChatCockpit-Login-Gate/);
assert.match(api, /loginGate\?:\s*string\s*\|\s*null/);

assert.match(app, /function readSecureLoginGate\(\): string \| null/);
assert.match(app, /\^cc_login_gate_\[A-Za-z0-9_-\]\{43\}\$/);
assert.match(app, /fetchOperatorStatus\(loginGate\)/);
assert.match(app, /loginOperator\(input, loginGate\)/);
assert.match(app, /fetchPasskeyAuthenticationOptions\(loginGate\)/);
assert.match(app, /verifyOperatorTotpLogin\([^)]*loginGate/s);
assert.match(app, /window\.history\.replaceState\(null, "", `\$\{consolePath\(\)\}\/`\)/);

process.stdout.write("VERIFY_STABLE_UI_WEB_OK\n");
