import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { detectBrowserLocale } from "../web/src/i18n.ts";

const root = path.resolve(import.meta.dirname, "..");
const i18nPath = path.join(root, "web", "src", "i18n.ts");
const resourcesPath = path.join(root, "web", "src", "i18n", "resources.ts");
const integrationsPath = path.join(root, "web", "src", "i18n", "integrations.ts");
const appPath = path.join(root, "web", "src", "App.tsx");
const dashboardPath = path.join(root, "web", "src", "components", "DashboardView.tsx");
const apiPath = path.join(root, "web", "src", "api.ts");
const setupPath = path.join(root, "web", "src", "components", "SetupWizardView.tsx");
const operatorSetupPath = path.join(root, "web", "src", "components", "OperatorSetupRequiredView.tsx");

const i18n = fs.readFileSync(i18nPath, "utf8");
const resources = fs.readFileSync(resourcesPath, "utf8");
const integrations = fs.readFileSync(integrationsPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");
const dashboard = fs.readFileSync(dashboardPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const setup = fs.readFileSync(setupPath, "utf8");
const operatorSetup = fs.readFileSync(operatorSetupPath, "utf8");

assert.equal(detectBrowserLocale(["zh-CN", "en-US"]), "zh-CN");
assert.equal(detectBrowserLocale(["zh-Hans-CN"]), "zh-CN");
assert.equal(detectBrowserLocale(["zh-SG"]), "zh-CN");
assert.equal(detectBrowserLocale(["zh-TW", "en-US"]), "en-US");
assert.equal(detectBrowserLocale(["ja-JP", "en-US"]), "en-US");
assert.equal(detectBrowserLocale(["ja-JP", "zh-Hans", "en-US"]), "zh-CN");

assert.match(i18n, /window\.localStorage, LOCALE_STORAGE_KEY/);
assert.match(i18n, /LEGACY_LOCALE_STORAGE_KEY = "tokenpilot:web:locale"/);
assert.match(i18n, /window\.sessionStorage, LOCALE_STORAGE_KEY/);
assert.doesNotMatch(i18n, /sessionStorage\.setItem\(LOCALE_STORAGE_KEY/);
assert.doesNotMatch(i18n, /GPT 助手/);

assert.match(resources, /title: "运行环境与资源中心"/);
assert.match(resources, /profilesTitle: "运行时配置"/);
assert.match(resources, /snapshotTitle: "资源清单快照"/);
assert.match(resources, /fingerprint: "指纹"/);

assert.match(integrations, /chatgptTitle: "ChatGPT App \/ MCP"/);
assert.match(integrations, /customGptTitle: "Custom GPT Actions"/);
assert.match(integrations, /apiBoundary: "机器 API 令牌与控制台管理员、ChatGPT OAuth 完全分离/);
assert.match(integrations, /机器 API 令牌不是 OAuth 前置条件/);

assert.match(app, /integrations: "\/ui\/integrations"/);
assert.match(app, /loadCompatibilityConfig\(nextLocale\)/);
assert.match(api, /new URLSearchParams\(\{ locale \}\)/);
assert.match(api, /\/api\/gpt\/config\?\$\{query\.toString\(\)\}/);
assert.match(app, /pathname === "\/ui\/gpt-helper"/);
assert.match(app, /window\.history\.replaceState\(null, "", VIEW_PATHS\.integrations\)/);
assert.doesNotMatch(app, /value: "gpt-helper"/);
assert.doesNotMatch(dashboard, /GptHelper|GPT Helper/);
assert.doesNotMatch(setup, /GptHelper|GPT Helper/);
assert.match(i18n, /setupAppAction: "在 ChatCockpit App 中设置"/);
assert.match(operatorSetup, /chatcockpit:\/\/operator\/setup/);
assert.match(operatorSetup, /desktopSetupAvailable/);
assert.match(i18n, /localUnlockFailed: "本机免密登录链接已失效/);
assert.match(app, /readAndClearLocalLoginGrant/);
assert.match(app, /redeemLocalLoginGrant\(localLoginGrant\)/);
assert.match(api, /"\/api\/operator\/local-login"/);

process.stdout.write("WEB_I18N_INTEGRATIONS_OK\n");
