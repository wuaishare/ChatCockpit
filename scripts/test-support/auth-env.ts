const AUTH_ENV_NAMES = [
  "CHATCOCKPIT_API_TOKEN",
  "TOKENPILOT_API_TOKEN",
  "CHATCOCKPIT_EXPOSED",
  "TOKENPILOT_EXPOSED"
] as const;

/**
 * Isolate verifiers that intentionally exercise ChatCockpit's machine-local,
 * unconfigured-auth mode from credentials/exposure flags of the host process
 * running the test suite.
 */
export function isolateMachineLocalUnconfiguredAuth(): () => void {
  const previous = new Map<string, string | undefined>();
  for (const name of AUTH_ENV_NAMES) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.CHATCOCKPIT_EXPOSED = "false";

  return () => {
    for (const name of AUTH_ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
