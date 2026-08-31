import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { generateTotpCode } from "../src/auth/operator-totp-service.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "login must set an Operator session cookie");
  return value.split(";", 1)[0];
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-web-operator-auth-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Operator auth fixture\n", "utf8");
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);

  const setupStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const setupService = new OperatorService({ store: setupStore });
  await setupService.setOwnerPassword({
    username: "owner",
    password: "test-password-correct-horse-battery-staple"
  });
  setupStore.close();

  const original = {
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-owner";
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const directExecutorsConfigPath = path.join(root, "direct-executors.json");
  const server = await listenTestServer(
    buildServer(paths, { directExecutorsConfigPath })
  );
  try {
    const status = await fetch(`${server.baseUrl}/api/operator/status`);
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      configured: boolean;
      desktopSetupAvailable: boolean;
    };
    assert.equal(statusBody.configured, true);
    assert.equal(
      statusBody.desktopSetupAvailable,
      process.platform === "darwin",
      "direct loopback setup should offer the native App handoff on macOS without LaunchServices discovery"
    );

    const anonymousJobs = await fetch(`${server.baseUrl}/api/jobs`);
    assert.equal(anonymousJobs.status, 401);

    const machineJobs = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { authorization: "Bearer test-token-machine-owner" }
    });
    assert.equal(machineJobs.status, 200);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-correct-horse-battery-staple"
      })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /chatcockpit_operator_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\//i);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.doesNotMatch(setCookie, /Secure/i);
    const loginBody = (await login.json()) as {
      ok: boolean;
      username: string;
      role: string;
      csrfToken: string;
    };
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.username, "owner");
    assert.equal(loginBody.role, "owner");
    assert.match(loginBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const cookie = cookiePair(login);

    const session = await fetch(`${server.baseUrl}/api/operator/session`, {
      headers: { cookie }
    });
    assert.equal(session.status, 200);
    const sessionBody = (await session.json()) as { csrfToken: string; username: string };
    assert.equal(sessionBody.username, "owner");
    assert.equal(sessionBody.csrfToken, loginBody.csrfToken);

    const cookieJobs = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie }
    });
    assert.equal(cookieJobs.status, 200);

    const anonymousExecutionPermissions = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`
    );
    assert.equal(anonymousExecutionPermissions.status, 401);

    const executionPermissions = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`,
      { headers: { cookie } }
    );
    assert.equal(executionPermissions.status, 200);
    const executionPermissionsBody = (await executionPermissions.json()) as {
      workspaceExecutionProfile: string;
      hostPermissionProfile: string;
      hostRiskLevel: string;
      workspaceApprovalPolicy: string;
      hostApprovalPolicy: string;
      capabilities: {
        workspaceArbitraryCommands: boolean;
        workspaceNetworkByRequest: boolean;
        hostManagedWorkspace: boolean;
        deviceDiagnostics: boolean;
        workspaceHostMutations: boolean;
        pureHostFileMutations: boolean;
        workspaceManagedProcesses: boolean;
        pureHostManagedProcesses: boolean;
        fullHostCommands: boolean;
      };
    };
    assert.equal(executionPermissionsBody.workspaceExecutionProfile, "development");
    assert.equal(executionPermissionsBody.hostPermissionProfile, "development");
    assert.equal(executionPermissionsBody.hostRiskLevel, "elevated");
    assert.equal(executionPermissionsBody.workspaceApprovalPolicy, "writer-authority");
    assert.equal(executionPermissionsBody.hostApprovalPolicy, "operator-required");
    assert.equal(executionPermissionsBody.capabilities.workspaceArbitraryCommands, true);
    assert.equal(executionPermissionsBody.capabilities.workspaceNetworkByRequest, true);
    assert.equal(executionPermissionsBody.capabilities.hostManagedWorkspace, true);
    assert.equal(executionPermissionsBody.capabilities.deviceDiagnostics, false);
    assert.equal(executionPermissionsBody.capabilities.workspaceHostMutations, true);
    assert.equal(executionPermissionsBody.capabilities.pureHostFileMutations, false);
    assert.equal(executionPermissionsBody.capabilities.workspaceManagedProcesses, true);
    assert.equal(executionPermissionsBody.capabilities.pureHostManagedProcesses, false);
    assert.equal(executionPermissionsBody.capabilities.fullHostCommands, false);

    const noCsrfExecutionPermissionUpdate = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json"
        },
        body: JSON.stringify({ hostPermissionProfile: "device-maintenance" })
      }
    );
    assert.equal(noCsrfExecutionPermissionUpdate.status, 403);
    assert.match(await noCsrfExecutionPermissionUpdate.text(), /CSRF_REQUIRED/);

    const executionPermissionUpdate = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": loginBody.csrfToken
        },
        body: JSON.stringify({ hostPermissionProfile: "device-maintenance" })
      }
    );
    assert.equal(executionPermissionUpdate.status, 200);
    const executionPermissionUpdateBody = (await executionPermissionUpdate.json()) as {
      hostPermissionProfile: string;
      hostRiskLevel: string;
      capabilities: {
        deviceDiagnostics: boolean;
        workspaceHostMutations: boolean;
        pureHostFileMutations: boolean;
        workspaceManagedProcesses: boolean;
        pureHostManagedProcesses: boolean;
        fullHostCommands: boolean;
      };
    };
    assert.equal(executionPermissionUpdateBody.hostPermissionProfile, "device-maintenance");
    assert.equal(executionPermissionUpdateBody.hostRiskLevel, "elevated");
    assert.equal(executionPermissionUpdateBody.capabilities.deviceDiagnostics, true);
    assert.equal(executionPermissionUpdateBody.capabilities.workspaceHostMutations, true);
    assert.equal(executionPermissionUpdateBody.capabilities.pureHostFileMutations, false);
    assert.equal(executionPermissionUpdateBody.capabilities.workspaceManagedProcesses, true);
    assert.equal(executionPermissionUpdateBody.capabilities.pureHostManagedProcesses, false);
    assert.equal(executionPermissionUpdateBody.capabilities.fullHostCommands, false);
    assert.equal(
      (fs.statSync(directExecutorsConfigPath).mode & 0o777).toString(8),
      "600"
    );
    assert.equal(
      (JSON.parse(fs.readFileSync(directExecutorsConfigPath, "utf8")) as {
        hostPermissionProfile?: string;
      }).hostPermissionProfile,
      "device-maintenance"
    );

    const workspacePermissionUpdate = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": loginBody.csrfToken
        },
        body: JSON.stringify({ workspaceExecutionProfile: "restricted" })
      }
    );
    assert.equal(workspacePermissionUpdate.status, 200);
    const workspacePermissionUpdateBody = (await workspacePermissionUpdate.json()) as {
      workspaceExecutionProfile: string;
      hostPermissionProfile: string;
      capabilities: { workspaceArbitraryCommands: boolean };
    };
    assert.equal(workspacePermissionUpdateBody.workspaceExecutionProfile, "restricted");
    assert.equal(workspacePermissionUpdateBody.hostPermissionProfile, "device-maintenance");
    assert.equal(workspacePermissionUpdateBody.capabilities.workspaceArbitraryCommands, false);
    assert.equal(
      (JSON.parse(fs.readFileSync(directExecutorsConfigPath, "utf8")) as {
        workspaceExecutionProfile?: string;
      }).workspaceExecutionProfile,
      "restricted"
    );
    const workspacePermissionRestore = await fetch(
      `${server.baseUrl}/api/operator/execution-permissions`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": loginBody.csrfToken
        },
        body: JSON.stringify({ workspaceExecutionProfile: "development" })
      }
    );
    assert.equal(workspacePermissionRestore.status, 200);

    const cookieMcp = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        cookie,
        "mcp-protocol-version": "2025-06-18"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });
    assert.equal(cookieMcp.status, 401);

    const noCsrfMutation = await fetch(`${server.baseUrl}/api/jobs/control/terminate-all`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(noCsrfMutation.status, 403);
    assert.match(await noCsrfMutation.text(), /CSRF_REQUIRED/);

    const csrfMutation = await fetch(`${server.baseUrl}/api/jobs/control/terminate-all`, {
      method: "POST",
      headers: {
        cookie,
        "x-chatcockpit-csrf": loginBody.csrfToken
      }
    });
    assert.equal(csrfMutation.status, 200);

    const ipPasskeyOptions = await fetch(
      `${server.baseUrl}/api/operator/passkeys/authentication/options`,
      { method: "POST" }
    );
    assert.equal(ipPasskeyOptions.status, 400);
    assert.match(await ipPasskeyOptions.text(), /PASSKEY_ORIGIN_UNSUPPORTED/);

    const passkeyBaseUrl = server.baseUrl.replace("127.0.0.1", "localhost");
    const passkeyLogin = await fetch(`${passkeyBaseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-correct-horse-battery-staple"
      })
    });
    assert.equal(passkeyLogin.status, 200);
    const passkeyLoginBody = (await passkeyLogin.json()) as { csrfToken: string };
    const passkeyCookie = cookiePair(passkeyLogin);

    const localPasskeyStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
    const localOwner = localPasskeyStore.getOwner();
    assert.ok(localOwner);
    const localOrigin = new URL(passkeyBaseUrl);
    localPasskeyStore.createPasskey({
      id: "passkey-local-route-fixture",
      principalId: localOwner.id,
      credentialId: "credential-local-route-fixture",
      publicKey: Uint8Array.from([1, 2, 3]),
      counter: 0,
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
      label: "Local Route Passkey",
      rpId: localOrigin.hostname,
      origin: localOrigin.origin,
      createdAt: "2026-08-16T10:30:00.000Z"
    });
    localPasskeyStore.close();

    const anonymousPasskeyOptions = await fetch(
      `${passkeyBaseUrl}/api/operator/passkeys/authentication/options`,
      { method: "POST" }
    );
    assert.equal(anonymousPasskeyOptions.status, 200);
    const anonymousPasskeyOptionsBody = (await anonymousPasskeyOptions.json()) as {
      challenge: string;
      rpId?: string;
      userVerification?: string;
      allowCredentials?: unknown;
    };
    assert.ok(anonymousPasskeyOptionsBody.challenge);
    assert.equal(anonymousPasskeyOptionsBody.rpId, localOrigin.hostname);
    assert.equal(anonymousPasskeyOptionsBody.userVerification, "required");
    assert.equal("allowCredentials" in anonymousPasskeyOptionsBody, false);

    const machinePasskeyList = await fetch(`${passkeyBaseUrl}/api/operator/passkeys`, {
      headers: { authorization: "Bearer test-token-machine-owner" }
    });
    assert.equal(machinePasskeyList.status, 401);
    assert.match(await machinePasskeyList.text(), /OPERATOR_SESSION_REQUIRED/);

    const passkeyList = await fetch(`${passkeyBaseUrl}/api/operator/passkeys`, {
      headers: { cookie: passkeyCookie }
    });
    assert.equal(passkeyList.status, 200);
    const passkeyListBody = (await passkeyList.json()) as {
      passkeys: Array<Record<string, unknown>>;
    };
    assert.equal(passkeyListBody.passkeys.length, 1);
    assert.equal(passkeyListBody.passkeys[0]?.label, "Local Route Passkey");
    assert.equal("credentialId" in (passkeyListBody.passkeys[0] ?? {}), false);
    assert.equal("publicKey" in (passkeyListBody.passkeys[0] ?? {}), false);
    assert.equal("counter" in (passkeyListBody.passkeys[0] ?? {}), false);

    const noCsrfPasskeyRegistration = await fetch(
      `${passkeyBaseUrl}/api/operator/passkeys/registration/options`,
      {
        method: "POST",
        headers: { cookie: passkeyCookie }
      }
    );
    assert.equal(noCsrfPasskeyRegistration.status, 403);

    const passkeyRegistration = await fetch(
      `${passkeyBaseUrl}/api/operator/passkeys/registration/options`,
      {
        method: "POST",
        headers: {
          cookie: passkeyCookie,
          "x-chatcockpit-csrf": passkeyLoginBody.csrfToken
        }
      }
    );
    assert.equal(passkeyRegistration.status, 200);
    const passkeyRegistrationBody = (await passkeyRegistration.json()) as {
      challenge: string;
      authenticatorSelection?: {
        residentKey?: string;
        userVerification?: string;
      };
    };
    assert.ok(passkeyRegistrationBody.challenge);
    assert.equal(passkeyRegistrationBody.authenticatorSelection?.residentKey, "required");
    assert.equal(passkeyRegistrationBody.authenticatorSelection?.userVerification, "required");

    const passkeyLogout = await fetch(`${passkeyBaseUrl}/api/operator/logout`, {
      method: "POST",
      headers: {
        cookie: passkeyCookie,
        "x-chatcockpit-csrf": passkeyLoginBody.csrfToken
      }
    });
    assert.equal(passkeyLogout.status, 200);

    const secondLogin = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-correct-horse-battery-staple"
      })
    });
    assert.equal(secondLogin.status, 200);
    const secondLoginBody = (await secondLogin.json()) as {
      csrfToken: string;
    };
    const secondCookie = cookiePair(secondLogin);

    const sessions = await fetch(`${server.baseUrl}/api/operator/sessions`, {
      headers: { cookie: secondCookie }
    });
    assert.equal(sessions.status, 200);
    const sessionsBody = (await sessions.json()) as {
      sessions: Array<{ current: boolean }>;
    };
    assert.equal(sessionsBody.sessions.length, 2);
    assert.equal(sessionsBody.sessions.filter((entry) => entry.current).length, 1);

    const revokeOthers = await fetch(
      `${server.baseUrl}/api/operator/sessions/revoke-others`,
      {
        method: "POST",
        headers: {
          cookie: secondCookie,
          "x-chatcockpit-csrf": secondLoginBody.csrfToken
        }
      }
    );
    assert.equal(revokeOthers.status, 200);
    assert.deepEqual(await revokeOthers.json(), {
      ok: true,
      revokedSessionCount: 1
    });

    const revokedFirstSession = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie }
    });
    assert.equal(revokedFirstSession.status, 401);

    const logoutWithoutCsrf = await fetch(`${server.baseUrl}/api/operator/logout`, {
      method: "POST",
      headers: { cookie: secondCookie }
    });
    assert.equal(logoutWithoutCsrf.status, 403);

    const logout = await fetch(`${server.baseUrl}/api/operator/logout`, {
      method: "POST",
      headers: {
        cookie: secondCookie,
        "x-chatcockpit-csrf": secondLoginBody.csrfToken
      }
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    const logoutBody = (await logout.json()) as { ok: true; loginPath: string };
    assert.match(logoutBody.loginPath, /^\/ui\/login\?gate=cc_login_gate_[A-Za-z0-9_-]{43}$/);
    const reloginDocument = await fetch(new URL(logoutBody.loginPath, server.baseUrl));
    assert.equal(reloginDocument.status, 200);

    const afterLogout = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie: secondCookie }
    });
    assert.equal(afterLogout.status, 401);

    const localGrantStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
    const localGrantService = new OperatorService({ store: localGrantStore });
    const localGrant = localGrantService.createLocalLoginGrant();
    localGrantStore.close();
    const localLogin = await fetch(`${server.baseUrl}/api/operator/local-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl
      },
      body: JSON.stringify({ grant: localGrant.grantSecret })
    });
    assert.equal(localLogin.status, 200);
    const localLoginCookie = cookiePair(localLogin);
    assert.match(localLoginCookie, /^chatcockpit_operator_session=/);
    const localLoginBody = (await localLogin.json()) as { csrfToken: string };
    assert.match(localLoginBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const localProtected = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie: localLoginCookie }
    });
    assert.equal(localProtected.status, 200);
    const reusedLocalGrant = await fetch(`${server.baseUrl}/api/operator/local-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl
      },
      body: JSON.stringify({ grant: localGrant.grantSecret })
    });
    assert.equal(reusedLocalGrant.status, 401);

    const initialTotpStatus = await fetch(`${server.baseUrl}/api/operator/totp`, {
      headers: { cookie: localLoginCookie }
    });
    assert.equal(initialTotpStatus.status, 200);
    assert.deepEqual(await initialTotpStatus.json(), {
      ok: true,
      enabled: false,
      recoveryCodesRemaining: 0,
      pendingEnrollment: false
    });

    const noCsrfTotpEnrollment = await fetch(`${server.baseUrl}/api/operator/totp/enrollment`, {
      method: "POST",
      headers: { cookie: localLoginCookie }
    });
    assert.equal(noCsrfTotpEnrollment.status, 403);

    const totpEnrollment = await fetch(`${server.baseUrl}/api/operator/totp/enrollment`, {
      method: "POST",
      headers: {
        cookie: localLoginCookie,
        "x-chatcockpit-csrf": localLoginBody.csrfToken
      }
    });
    assert.equal(totpEnrollment.status, 200);
    const totpEnrollmentBody = (await totpEnrollment.json()) as {
      enrollmentId: string;
      secret: string;
      otpauthUri: string;
    };
    assert.match(totpEnrollmentBody.secret, /^[A-Z2-7]{32}$/);
    assert.match(totpEnrollmentBody.otpauthUri, /^otpauth:\/\/totp\//);

    const enableTotp = await fetch(`${server.baseUrl}/api/operator/totp/enrollment/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: localLoginCookie,
        "x-chatcockpit-csrf": localLoginBody.csrfToken
      },
      body: JSON.stringify({
        enrollmentId: totpEnrollmentBody.enrollmentId,
        code: generateTotpCode(totpEnrollmentBody.secret, Date.now())
      })
    });
    assert.equal(enableTotp.status, 200);
    const enableTotpBody = (await enableTotp.json()) as {
      recoveryCodes: string[];
      recoveryCodesRemaining: number;
      revokedSessionCount: number;
    };
    assert.equal(enableTotpBody.recoveryCodes.length, 10);
    assert.equal(enableTotpBody.recoveryCodesRemaining, 10);
    assert.ok(enableTotpBody.revokedSessionCount >= 0);

    const passwordWithTotp = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-correct-horse-battery-staple"
      })
    });
    assert.equal(passwordWithTotp.status, 200);
    assert.equal(passwordWithTotp.headers.get("set-cookie"), null);
    const passwordWithTotpBody = (await passwordWithTotp.json()) as {
      requiresSecondFactor: boolean;
      challenge: string;
      expiresAt: string;
    };
    assert.equal(passwordWithTotpBody.requiresSecondFactor, true);
    assert.match(passwordWithTotpBody.challenge, /^cc_mfa_[A-Za-z0-9_-]{43}$/);

    const wrongSecondFactor = await fetch(`${server.baseUrl}/api/operator/totp/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challenge: passwordWithTotpBody.challenge,
        verification: "000000"
      })
    });
    assert.equal(wrongSecondFactor.status, 401);

    const totpLogin = await fetch(`${server.baseUrl}/api/operator/totp/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challenge: passwordWithTotpBody.challenge,
        verification: generateTotpCode(totpEnrollmentBody.secret, Date.now())
      })
    });
    assert.equal(totpLogin.status, 200);
    const totpLoginBody = (await totpLogin.json()) as { csrfToken: string };
    const totpLoginCookie = cookiePair(totpLogin);
    assert.match(totpLoginBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);

    const recoveryPasswordLogin = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-correct-horse-battery-staple"
      })
    });
    const recoveryPasswordLoginBody = (await recoveryPasswordLogin.json()) as {
      requiresSecondFactor: boolean;
      challenge: string;
    };
    assert.equal(recoveryPasswordLoginBody.requiresSecondFactor, true);
    const recoveryLogin = await fetch(`${server.baseUrl}/api/operator/totp/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challenge: recoveryPasswordLoginBody.challenge,
        verification: enableTotpBody.recoveryCodes[0]
      })
    });
    assert.equal(recoveryLogin.status, 200);

    const mfaLocalGrantStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
    const mfaLocalGrantService = new OperatorService({ store: mfaLocalGrantStore });
    const mfaLocalGrant = mfaLocalGrantService.createLocalLoginGrant();
    mfaLocalGrantStore.close();
    const mfaLocalLogin = await fetch(`${server.baseUrl}/api/operator/local-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl
      },
      body: JSON.stringify({ grant: mfaLocalGrant.grantSecret })
    });
    assert.equal(
      mfaLocalLogin.status,
      200,
      "Machine-local one-time unlock must remain a separate authority from password TOTP"
    );

    const disableTotp = await fetch(`${server.baseUrl}/api/operator/totp/disable`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: totpLoginCookie,
        "x-chatcockpit-csrf": totpLoginBody.csrfToken
      },
      body: JSON.stringify({ verification: enableTotpBody.recoveryCodes[1] })
    });
    assert.equal(disableTotp.status, 200);
    const disabledTotpStatus = await fetch(`${server.baseUrl}/api/operator/totp`, {
      headers: { cookie: totpLoginCookie }
    });
    assert.equal(disabledTotpStatus.status, 200);
    assert.deepEqual(await disabledTotpStatus.json(), {
      ok: true,
      enabled: false,
      recoveryCodesRemaining: 0,
      pendingEnrollment: false
    });

    const crossOriginGrantStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
    const crossOriginGrantService = new OperatorService({ store: crossOriginGrantStore });
    const crossOriginGrant = crossOriginGrantService.createLocalLoginGrant();
    crossOriginGrantStore.close();
    const crossOriginLogin = await fetch(`${server.baseUrl}/api/operator/local-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example"
      },
      body: JSON.stringify({ grant: crossOriginGrant.grantSecret })
    });
    assert.equal(crossOriginLogin.status, 403);

    const lanApp = buildServer(paths);
    try {
      const lanPasskeyOptions = await lanApp.inject({
        method: "POST",
        url: "/api/operator/passkeys/authentication/options",
        headers: { host: ["192", "168", "1", "25"].join(".") }
      });
      assert.equal(lanPasskeyOptions.statusCode, 400);
      assert.match(lanPasskeyOptions.body, /PASSKEY_ORIGIN_UNSUPPORTED/);
    } finally {
      await lanApp.close();
    }

    process.env.CHATCOCKPIT_EXPOSED = "true";
    process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";
    delete process.env.CHATCOCKPIT_API_TOKEN;
    const publicApp = buildServer(paths);
    try {
      const publicStatus = await publicApp.inject({
        method: "GET",
        url: "/api/operator/status",
        headers: { host: "chatcockpit.example.com" }
      });
      assert.equal(publicStatus.statusCode, 200);
      assert.equal(
        (publicStatus.json() as { desktopSetupAvailable: boolean }).desktopSetupAvailable,
        false,
        "Public-origin Operator status must not advertise a local Desktop setup launcher"
      );

      const publicPasskeyOptions = await publicApp.inject({
        method: "POST",
        url: "/api/operator/passkeys/authentication/options",
        headers: {
          host: "chatcockpit.example.com",
          "x-forwarded-proto": "https"
        }
      });
      assert.equal(
        publicPasskeyOptions.statusCode,
        404,
        "A loopback Passkey must not become usable on the public HTTPS origin"
      );
      assert.match(publicPasskeyOptions.body, /PASSKEY_NOT_CONFIGURED/);

      const publicLocalLogin = await publicApp.inject({
        method: "POST",
        url: "/api/operator/local-login",
        headers: {
          host: "chatcockpit.example.com",
          "content-type": "application/json"
        },
        payload: { grant: "cc_local_login_not_public" }
      });
      assert.equal(
        publicLocalLogin.statusCode,
        404,
        "Local login redemption must not exist on a public-origin request"
      );
      const forwardedLoopbackLogin = await publicApp.inject({
        method: "POST",
        url: "/api/operator/local-login",
        headers: {
          host: "127.0.0.1",
          "x-forwarded-for": "203.0.113.10",
          "x-forwarded-proto": "https",
          "content-type": "application/json"
        },
        payload: { grant: "cc_local_login_not_public" }
      });
      assert.equal(
        forwardedLoopbackLogin.statusCode,
        404,
        "Proxied requests must never qualify for the loopback-only local login route"
      );

      const publicLogin = await publicApp.inject({
        method: "POST",
        url: "/api/operator/login",
        headers: {
          host: "chatcockpit.example.com",
          "content-type": "application/json"
        },
        payload: {
          username: "owner",
          password: "test-password-correct-horse-battery-staple"
        }
      });
      assert.equal(publicLogin.statusCode, 200);
      const publicCookie = publicLogin.headers["set-cookie"] ?? "";
      assert.equal(typeof publicCookie, "string");
      assert.match(String(publicCookie), /Secure/i);
      assert.match(String(publicCookie), /HttpOnly/i);
      assert.match(String(publicCookie), /SameSite=Strict/i);
      assert.doesNotMatch(String(publicCookie), /Domain=/i);

      const publicCookiePair = String(publicCookie).split(";", 1)[0];
      const publicProtected = await publicApp.inject({
        method: "GET",
        url: "/api/jobs",
        headers: {
          host: "chatcockpit.example.com",
          cookie: publicCookiePair
        }
      });
      assert.equal(
        publicProtected.statusCode,
        200,
        "Exposed Web Owner sessions must work without a machine API token"
      );
    } finally {
      await publicApp.close();
    }
  } finally {
    await server.close();
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
  }

  const permissionsUiSource = fs.readFileSync(
    path.join(
      import.meta.dirname,
      "../web/src/components/HostExecutionPermissionsManager.tsx"
    ),
    "utf8"
  );
  assert.match(permissionsUiSource, /OAuth Full Access/);
  assert.match(permissionsUiSource, /OAuth Full Access[^\n]+Pure Host[^\n]+托管进程/s);
  assert.match(permissionsUiSource, /durable Process Supervisor/);
  assert.match(
    permissionsUiSource,
    /System-wide arbitrary PID attach\/list\/kill remains unavailable/
  );
  assert.match(
    permissionsUiSource,
    /系统级任意 PID attach\/list\/kill 仍不会开放/
  );
  assert.doesNotMatch(
    permissionsUiSource,
    /Direct shell\/script interpreter entry points and long-lived Pure Host managed processes remain blocked/
  );
  assert.doesNotMatch(
    permissionsUiSource,
    /直接 shell\/脚本解释器与 Pure Host 长期托管进程继续被阻止/
  );

  process.stdout.write("WEB_OPERATOR_AUTH_OK\n");
}

await main();
