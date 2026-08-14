import type { ProductIdentityKey } from "../types.js";

export interface ProductIdentity {
  key: ProductIdentityKey;
  displayName: "TokenPilot" | "ChatCockpit";
  packageName: "tokenpilot" | "chatcockpit";
  cliName: "tokenpilot" | "chatcockpit";
  envPrefix: "TOKENPILOT" | "CHATCOCKPIT";
  stateDirName: ".tokenpilot" | ".chatcockpit";
  applicationSupportName: "TokenPilot" | "ChatCockpit";
  mcpServerName: "tokenpilot" | "chatcockpit";
  mcpNamespace: "tokenpilot" | "chatcockpit";
  oauthMcpScope: "tokenpilot:mcp" | "chatcockpit:mcp";
  appName: "TokenPilot" | "ChatCockpit";
  bundleIdentifier: "cn.wuaishare.TokenPilot" | "cn.wuaishare.ChatCockpit";
  launchAgentPrefix: "com.wuaishare.tokenpilot" | "com.wuaishare.chatcockpit";
  builtInDirectExecutorId: "tokenpilot-direct" | "builtin-direct";
  asyncRunnerRuntimeKind: "tokenpilot-runner" | "async-runner";
  localResourceSourceKind: "tokenpilot-local" | "control-plane-local";
  defaultRepoId: "tokenpilot" | "primary";
  localTokenPrefix: "tp_local" | "cc_local";
  oauthOpaquePrefix: "tp" | "cc";
}

export const TOKENPILOT_PRODUCT_IDENTITY: ProductIdentity = {
  key: "tokenpilot",
  displayName: "TokenPilot",
  packageName: "tokenpilot",
  cliName: "tokenpilot",
  envPrefix: "TOKENPILOT",
  stateDirName: ".tokenpilot",
  applicationSupportName: "TokenPilot",
  mcpServerName: "tokenpilot",
  mcpNamespace: "tokenpilot",
  oauthMcpScope: "tokenpilot:mcp",
  appName: "TokenPilot",
  bundleIdentifier: "cn.wuaishare.TokenPilot",
  launchAgentPrefix: "com.wuaishare.tokenpilot",
  builtInDirectExecutorId: "tokenpilot-direct",
  asyncRunnerRuntimeKind: "tokenpilot-runner",
  localResourceSourceKind: "tokenpilot-local",
  defaultRepoId: "tokenpilot",
  localTokenPrefix: "tp_local",
  oauthOpaquePrefix: "tp"
};

export const CHATCOCKPIT_PRODUCT_IDENTITY: ProductIdentity = {
  key: "chatcockpit",
  displayName: "ChatCockpit",
  packageName: "chatcockpit",
  cliName: "chatcockpit",
  envPrefix: "CHATCOCKPIT",
  stateDirName: ".chatcockpit",
  applicationSupportName: "ChatCockpit",
  mcpServerName: "chatcockpit",
  mcpNamespace: "chatcockpit",
  oauthMcpScope: "chatcockpit:mcp",
  appName: "ChatCockpit",
  bundleIdentifier: "cn.wuaishare.ChatCockpit",
  launchAgentPrefix: "com.wuaishare.chatcockpit",
  builtInDirectExecutorId: "builtin-direct",
  asyncRunnerRuntimeKind: "async-runner",
  localResourceSourceKind: "control-plane-local",
  defaultRepoId: "primary",
  localTokenPrefix: "cc_local",
  oauthOpaquePrefix: "cc"
};

export const DEFAULT_PRODUCT_IDENTITY = CHATCOCKPIT_PRODUCT_IDENTITY;

export function productIdentityForKey(key: ProductIdentityKey): ProductIdentity {
  return key === "chatcockpit"
    ? CHATCOCKPIT_PRODUCT_IDENTITY
    : TOKENPILOT_PRODUCT_IDENTITY;
}
