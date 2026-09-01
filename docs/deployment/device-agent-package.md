# ChatCockpit Device Agent Portable Package (macOS)

Phase 11.1 adds a self-contained macOS Device Agent package for headless or remote ChatCockpit nodes. Phase 11.2 adds the fail-closed public distribution and Web onboarding contract around that package.

The package is designed for a target Mac that does **not** already have Node.js, npm, or a ChatCockpit source checkout. It reuses the same reviewed macOS Runtime payload used by ChatCockpit Desktop, including the exact bundled Node runtime, compiled ChatCockpit control plane, Device Agent service manager, and Runtime lifecycle manager.

## Trust and release boundary

There are two explicit package modes.

Ordinary engineering packages remain:

```text
distributionTrust=development
releaseEligible=false
```

They are suitable for local engineering proof only and are never projected by the Web Cockpit as a public native-package bootstrap.

Release packages use:

```text
distributionTrust=release
releaseEligible=true
```

Release mode is fail-closed. It requires the embedded Runtime build provenance to be clean and to contain a concrete build ID and source revision. The public distribution publisher then requires both arm64 and x64 packages to use the same source revision and bundled Node version, verifies archive checksums, and emits a checksum-bound distribution manifest.

`distributionTrust=release` is a ChatCockpit release-eligibility state, **not** a claim that the archive is Apple Developer ID signed, notarized, stapled, or cryptographically signed by a publisher key. HTTPS and SHA-256 protect the configured bootstrap channel and artifact integrity; Apple certification remains a separate distribution milestone.

## Build

For a normal engineering package on macOS:

```bash
npm run build:macos-device-agent-package
```

To build a specific development architecture:

```bash
bash ./scripts/build-macos-device-agent-package.sh --arch arm64
bash ./scripts/build-macos-device-agent-package.sh --arch x64
```

For the release-eligible dual-architecture distribution from a **clean** source revision:

```bash
npm run build:macos-device-agent-release
```

That command builds release-mode arm64 and x64 archives, publishes the distribution directory, and runs the distribution verifier. Dirty source provenance is rejected rather than silently stamped as release-eligible.

The builder first creates and verifies the canonical self-contained macOS Runtime payload, then wraps it with a restricted Device Agent launcher. Generated `dist/device-agent` output is explicitly excluded from the embedded Runtime so previous packages or public distribution artifacts cannot recursively leak into a new Runtime payload.

Per-architecture output:

```text
dist/device-agent/macos/<arch>/
├── ChatCockpitDeviceAgent/
│   ├── bin/chatcockpit-device
│   ├── manifest.json
│   └── runtime/TokenPilotRuntime/
├── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz.sha256
```

Release distribution output:

```text
dist/device-agent/distribution/
├── manifest.json
├── manifest.json.sha256
├── ChatCockpit-Device-Agent-<version>-macos-arm64.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-x64.tar.gz
```

`TokenPilotRuntime` remains an internal compatibility payload directory name in the current packaging generation. It does not change the package/product identity exposed to operators, which is ChatCockpit.

## Public distribution configuration

A built release directory is not automatically exposed. The Control Plane must be configured with the exact local distribution directory, for example through the managed Runtime `server.env`:

```text
CHATCOCKPIT_DEVICE_AGENT_DISTRIBUTION_DIR=/path/to/dist/device-agent/distribution
```

The managed macOS lifecycle forwards this setting only to the Control Plane. The Runner and Process Supervisor do not need access to the distribution directory.

The Hub exposes only these anonymous distribution routes when the configured directory validates successfully:

```text
/downloads/device-agent/manifest.json
/downloads/device-agent/macos/arm64/<declared-release-file>.tar.gz
/downloads/device-agent/macos/x64/<declared-release-file>.tar.gz
```

An archive filename must exactly match the validated manifest. Other files in the directory are not made public by the distribution surface.

The Add Device onboarding projection remains fail-closed. `bootstrap.nativePackage.available` becomes `true` only when all of the following are simultaneously true:

- the distribution directory is configured and readable;
- the manifest checksum, release eligibility, metadata, archive size, and archive SHA-256 validate;
- both arm64 and x64 artifacts are present;
- a canonical public origin is configured as HTTPS;
- the current public-route verification evidence matches that canonical origin.

If any condition fails, the UI hides package download actions and reports the bounded reason instead of advertising a stale or non-runnable URL.

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

The package and distribution verifiers check, among other things:

- package schema, architecture, trust level, and release eligibility;
- package entrypoint checksum and executable mode;
- embedded Runtime manifest checksum and critical-file hashes;
- clean embedded build provenance for release packages;
- bundled Node, CLI, Device Agent service manager, and Runtime manager presence;
- symlink containment inside the package root;
- absence of generated Device Agent package/distribution output inside the embedded Runtime;
- native-architecture live execution of `status --json` using an isolated HOME and no system Node path;
- exact public distribution manifest checksum;
- exact archive size and SHA-256 for both architectures;
- embedded package-manifest checksum and build-provenance agreement with the public manifest;
- same source revision and bundled Node version across arm64 and x64;
- no undeclared files in the published distribution directory.

Useful focused commands are:

```bash
npm run verify:macos-device-agent-package
npm run verify:macos-device-agent-package-contract
npm run verify:device-agent-distribution-catalog
npm run verify:device-agent-distribution
```

The catalog/onboarding contract is also part of the normal protocol and CI verification surface, so later changes cannot silently revert the fail-closed public-bootstrap rules.
