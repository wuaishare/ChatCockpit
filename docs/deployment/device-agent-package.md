# ChatCockpit Device Agent Portable Package (macOS)

Phase 11.1 adds a self-contained macOS Device Agent engineering package for headless or remote ChatCockpit nodes.

The package is designed for a target Mac that does **not** already have Node.js, npm, or a ChatCockpit source checkout. It reuses the same reviewed macOS runtime payload used by ChatCockpit Desktop, including the exact bundled Node runtime, compiled ChatCockpit control plane, Device Agent service manager, and Runtime lifecycle manager.

## Current trust boundary

Phase 11.1 is an engineering/distribution artifact, not yet a public one-click bootstrap channel.

Every package manifest is intentionally stamped:

```text
distributionTrust=development
releaseEligible=false
```

Until Phase 11.2 publishes a real verified download location and metadata contract, the Web Cockpit Add Device wizard continues to report native-package bootstrap as unavailable. The presence of a locally built archive must not be advertised as a public download.

## Build

On macOS:

```bash
npm run build:macos-device-agent-package
```

To build a specific architecture:

```bash
bash ./scripts/build-macos-device-agent-package.sh --arch arm64
bash ./scripts/build-macos-device-agent-package.sh --arch x64
```

The builder first creates and verifies the canonical self-contained macOS Runtime payload, then wraps it with a restricted Device Agent launcher.

Output layout:

```text
dist/device-agent/macos/<arch>/
├── ChatCockpitDeviceAgent/
│   ├── bin/chatcockpit-device
│   ├── manifest.json
│   └── runtime/TokenPilotRuntime/
├── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz.sha256
```

`TokenPilotRuntime` remains an internal compatibility payload directory name in the current packaging generation. It does not change the package/product identity exposed to operators, which is ChatCockpit.

## Operator commands

After extracting the archive, use the single package entrypoint:

```bash
./ChatCockpitDeviceAgent/bin/chatcockpit-device status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device connect https://hub.example.com --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device discover --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device route status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device workspace set /path/to/development-workspace --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device workspace status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device service start
./ChatCockpitDeviceAgent/bin/chatcockpit-device service status
./ChatCockpitDeviceAgent/bin/chatcockpit-device runtime start
./ChatCockpitDeviceAgent/bin/chatcockpit-device runtime status
```

The launcher intentionally exposes only Device Agent and bounded Runtime lifecycle commands. It is not a generic pass-through to the complete ChatCockpit CLI.

A headless package has no GUI workspace picker, so persistent execution is fail-closed until an explicit development workspace is configured. `workspace set` resolves an existing directory to its canonical path and persists only that path in a mode-0600 JSON file under ChatCockpit state. Persistent `agent`, `service start/restart`, and `runtime start/restart` refuse to run while no valid workspace is configured, and the embedded Runtime directory itself cannot be selected as the development workspace. One-shot enrollment/status/discovery commands remain available before workspace selection so the device can be paired first.

## No system Node dependency

The launcher resolves Node only from the embedded runtime:

```text
runtime/TokenPilotRuntime/node/bin/node
```

It sets the packaged distribution context to the embedded Runtime and then invokes the compiled Device Agent CLI. A clean-archive live proof runs successfully with an isolated temporary HOME and a PATH containing only standard macOS system directories; no external `node`, `npm`, or source checkout is required.

## State and identity

The archive is immutable application/runtime material. Device identity and writable state are not stored inside the package.

By default packaged state remains under the ChatCockpit Application Support state root. Operators may override `CHATCOCKPIT_STATE_ROOT` when an isolated state root is required. Device enrollment creates the local Ed25519 identity only at runtime; rebuilding or replacing the package does not embed or regenerate an existing enrolled identity.

The background Device Agent remains a separate LaunchAgent from the stoppable Control Plane / Runner / Process Supervisor stack. This preserves the management channel needed to receive a future Runtime Start operation even when the ordinary Runtime is stopped.

## Verification

The package verifier checks:

- package schema, architecture, trust level, and release eligibility;
- package entrypoint checksum and executable mode;
- embedded Runtime manifest checksum;
- every critical file hash declared by the embedded Runtime manifest;
- required bundled Node, CLI, Device Agent service manager, and Runtime manager files;
- symlink containment inside the package root;
- native-architecture live execution of `status --json` using an isolated HOME and no system Node path.

Run it directly against the current-architecture package with:

```bash
npm run verify:macos-device-agent-package
```

## Phase 11.2 boundary

Phase 11.2 should add the public bootstrap/distribution contract rather than weakening P11.1 verification. That work must define a real HTTPS download location, checksummed public metadata, architecture selection, trust/release eligibility, and the Web Cockpit onboarding projection before `bootstrap.nativePackage.available` may become true.
