import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  const filePath = path.join(root, relativePath);
  assert.equal(fs.existsSync(filePath), true, `${relativePath} must exist`);
  return fs.readFileSync(filePath, "utf8");
}

const app = read("web/src/App.tsx");
const headerI18n = read("web/src/i18n.ts");
const view = read("web/src/components/PublicAccessView.tsx");
const copy = read("web/src/i18n/public-access.ts");
const styles = read("web/src/styles.css");

assert.match(app, /type ViewKey = [^;]*"publicAccess"/s);
assert.match(app, /publicAccess:\s*consolePath\("public-access"\)/);
assert.match(app, /route === "public-access"/);
assert.match(app, /import\("\.\/components\/PublicAccessView"\)/);
assert.match(app, /value:\s*"publicAccess"/);
assert.match(app, /app-toolbar__group app-toolbar__group--views/);
assert.match(app, /<PublicAccessView[\s\S]*status=\{integrationStatus\}/s);
assert.match(app, /exposed=\{health\.exposed\}/);
assert.match(app, /onOpenIntegrations=\{\(\) => navigateView\("integrations"\)\}/);
assert.match(app, /getPublicAccessCopy\(locale\)/);

assert.match(view, /status:\s*IntegrationStatusResponse/);
assert.match(view, /status\.localCockpitUrl/);
assert.match(view, /status\.publicCockpitUrl/);
assert.match(view, /status\.localApiBaseUrl/);
assert.match(view, /status\.publicApiBaseUrl/);
assert.match(view, /status\.openapiUrl/);
assert.match(view, /status\.mcp\.endpoint/);
assert.match(view, /status\.mcp\.oauthStatus/);
assert.match(view, /status\.publicApiBaseUrl\?\.startsWith\("https:\/\/"\) === true/);
assert.match(view, /const hasPublicApi = Boolean\(status\.publicApiBaseUrl\)/);
assert.match(view, /!hasPublicApi \? "default" : publicHttpsReady \? "success" : "warning"/);
assert.match(view, /className="summary-entry-link"/);
assert.match(view, /onOpenIntegrations:\s*\(\) => void/);
assert.doesNotMatch(view, /fetch\(|fetchIntegrationStatus|requestJson|setAccessPolicy|machine-token/i);

assert.match(headerI18n, /publicAccess:\s*"公网接入"/);
assert.match(headerI18n, /publicAccess:\s*"Public Access"/);
assert.match(copy, /reachabilityTitle:\s*"可达性概览"/);
assert.match(copy, /publicCockpit:\s*"公网控制台"/);
assert.match(copy, /existingEnvironment:\s*"现有环境"/);
assert.match(copy, /reachabilityTitle:\s*"Reachability overview"/);
assert.match(copy, /publicCockpit:\s*"Public Cockpit"/);
assert.match(copy, /existingEnvironment:\s*"Existing environment"/);

const providerFiction = `${view}\n${copy}`;
assert.doesNotMatch(providerFiction, /cloudflared|ngrok|\bfrpc\b|pinggy|binaryExists|providerInstalled/i);
assert.doesNotMatch(providerFiction, /provider\s+(is\s+)?installed|provider\s+(is\s+)?ready/i);
assert.match(styles, /\.app-toolbar__group--views\s*\{[\s\S]*overflow-x:\s*auto/s);
assert.match(styles, /\.app-toolbar__group--views \.ant-segmented\s*\{[\s\S]*width:\s*max-content/s);

process.stdout.write("VERIFY_WEB_PUBLIC_ACCESS_OK\n");
