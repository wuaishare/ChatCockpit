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
assert.match(api, /X-ChatCockpit-OAuth-Request-Id/);
assert.match(api, /loginGate\?:\s*string\s*\|\s*null/);
assert.match(api, /oauthRequestId\?:\s*string\s*\|\s*null/);

assert.match(app, /function readSecureLoginGate\(\): string \| null/);
assert.match(app, /function readOAuthLoginBootstrap\(\): OAuthLoginBootstrap \| null/);
assert.match(app, /\^cc_login_gate_\[A-Za-z0-9_-\]\{43\}\$/);
assert.match(app, /fetchOperatorStatus\(loginGate, oauthBootstrap\?\.requestId\)/);
assert.match(app, /loginOperator\(input, loginGate, oauthBootstrap\?\.requestId\)/);
assert.match(app, /fetchPasskeyAuthenticationOptions\([\s\S]*oauthBootstrap\?\.requestId[\s\S]*\)/);
assert.match(app, /verifyOperatorTotpLogin\([\s\S]*oauthBootstrap\?\.requestId[\s\S]*\)/);
assert.match(app, /function localLoginContinuationPath\(\): string \| null/);
assert.match(app, /const LOCAL_LOGIN_CONTINUATION_TARGETS =/);
for (const [target, route] of [
  ["projects", "projects"],
  ["work", "continuity\/tasks"],
  ["runtime", "runtime"],
  ["resources", "resources"],
  ["devices", "devices"],
  ["publicAccess", "public-access"],
  ["integrations", "integrations"]
] as const) {
  assert.match(app, new RegExp(`${target}: consolePath\\("${route}"\\)`));
}
assert.match(app, /if \(!target \|\| !\(target in LOCAL_LOGIN_CONTINUATION_TARGETS\)\) return null/);
assert.match(app, /return LOCAL_LOGIN_CONTINUATION_TARGETS\[target as LocalLoginContinuationTarget\]/);
assert.doesNotMatch(app, /consolePath\(target\)/);
assert.match(app, /localLoginContinuationPath\(\) \?\? `\$\{consolePath\(\)\}\/`/);
assert.match(app, /window\.dispatchEvent\(new PopStateEvent\("popstate"\)\)/);
assert.doesNotMatch(app, /window\.location\.(?:assign|replace)\(target\)/);

process.stdout.write("VERIFY_STABLE_UI_WEB_OK\n");
