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
const api = read("web/src/api.ts");
const types = read("web/src/types.ts");
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
assert.match(app, /providerStatus=\{connectivityProviderStatus\}/);
assert.match(app, /providerStatusError=\{connectivityProviderStatusError\}/);
assert.match(app, /fetchConnectivityProviders\(token\)/);
assert.match(app, /setConnectivityProviderStatus\(providerResponse\)/);
assert.match(app, /setConnectivityProviderStatusError\(getErrorMessage\(error\)\)/);
assert.match(app, /onOpenIntegrations=\{\(\) => navigateView\("integrations"\)\}/);
assert.match(app, /getPublicAccessCopy\(locale\)/);

assert.match(api, /fetchConnectivityProviders/);
assert.match(api, /requestJson<ConnectivityProviderPublicSnapshot>\("\/api\/connectivity\/providers", token\)/);
assert.match(types, /interface ConnectivityProviderPublicSnapshot/);
assert.match(types, /managedByChatCockpit:\s*boolean/);
assert.doesNotMatch(types, /machineAdapter/);
assert.match(types, /"adapter-not-implemented"/);

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
assert.match(view, /providerStatus:\s*ConnectivityProviderPublicSnapshot \| null/);
assert.match(view, /providerStatusError:\s*string \| null/);
assert.match(view, /providerStatus\.providers\.map/);
assert.match(view, /provider\.displayName/);
assert.match(view, /action\.reason === "adapter-not-implemented"/);
assert.match(view, /provider\.managedByChatCockpit/);
assert.match(view, /provider\.actions[\s\S]*\.filter\(\(action\) => action\.available\)/s);
assert.match(view, /providerUseAppCli/);
assert.match(view, /onOpenIntegrations:\s*\(\) => void/);
assert.doesNotMatch(view, /fetch\(|fetchIntegrationStatus|fetchConnectivityProviders|requestJson|setAccessPolicy|machine-token|prepareConnectivityProvider|executeConnectivityProvider/i);
assert.doesNotMatch(view, /planId|stdout|stderr|\/opt\/homebrew|\/usr\/local\/bin|\bbrew\b/i);
assert.doesNotMatch(view, /Button[^\n]*(Install|Upgrade|Uninstall)|Start Tunnel|Cloudflare Login/i);

assert.match(headerI18n, /publicAccess:\s*"公网接入"/);
assert.match(headerI18n, /publicAccess:\s*"Public Access"/);
assert.match(copy, /reachabilityTitle:\s*"可达性概览"/);
assert.match(copy, /publicCockpit:\s*"公网控制台"/);
assert.match(copy, /existingEnvironment:\s*"现有环境"/);
assert.match(copy, /reachabilityTitle:\s*"Reachability overview"/);
assert.match(copy, /publicCockpit:\s*"Public Cockpit"/);
assert.match(copy, /existingEnvironment:\s*"Existing environment"/);
assert.match(copy, /providersTitle:\s*"本机接入组件"/);
assert.match(copy, /providerExternalUnmanaged:\s*"外部环境 · 未接管"/);
assert.match(copy, /providerObserveOnly:\s*"仅观察 · 尚无机器 Adapter"/);
assert.match(copy, /providersTitle:\s*"Machine connectors"/);
assert.match(copy, /providerExternalUnmanaged:\s*"External environment · unmanaged"/);
assert.match(copy, /providerObserveOnly:\s*"Observe only · no machine adapter yet"/);

const providerFiction = `${view}\n${copy}`;
assert.doesNotMatch(providerFiction, /cloudflared|ngrok|\bfrpc\b|pinggy|binaryExists|providerInstalled/i);
assert.doesNotMatch(providerFiction, /provider\s+(is\s+)?installed|provider\s+(is\s+)?ready/i);
assert.match(styles, /\.public-access-provider-status\s*\{/);
assert.match(styles, /\.public-access-provider-primary\s*\{/);
assert.match(styles, /\.app-toolbar__group--views\s*\{[\s\S]*overflow-x:\s*auto/s);
assert.match(styles, /\.app-toolbar__group--views \.ant-segmented\s*\{[\s\S]*width:\s*max-content/s);

process.stdout.write("VERIFY_WEB_PUBLIC_ACCESS_OK\n");
