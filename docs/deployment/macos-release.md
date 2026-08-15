# ChatCockpit macOS Distribution and Release

ChatCockpit separates **distribution engineering** from **Apple production certification**. This keeps development moving without misrepresenting unsigned or unnotarized artifacts as public production releases.

## Current status

The repository currently implements the secretless engineering lane:

- Xcode distribution project and archive boundary;
- hardened-runtime entitlement policy contract;
- fail-closed Developer ID signing entrypoint;
- fail-closed `notarytool` / stapling contract;
- arm64 and x64 development DMG construction;
- real `hdiutil verify` plus read-only mount/content verification;
- SHA-256-bound release manifests;
- explicit `distributionTrust` / `releaseEligible` trust state;
- public macOS update metadata contract;
- Manual Verified Update v1 in the desktop Settings UI;
- an explicit, tag-only credentialed GitHub release workflow contract.

The project owner is not currently using an Apple Developer Program production identity for ChatCockpit. Therefore the repository does **not** claim that a public ChatCockpit DMG is currently:

- Developer ID signed;
- accepted by Gatekeeper as a production distribution;
- Apple notarized;
- stapled;
- production/release eligible.

Apple production certification is deferred, not removed.

## Two distribution lanes

```text
reviewed commit
  |
  +-- secretless engineering lane
  |     -> unsigned distribution app/archive
  |     -> development DMG
  |     -> hdiutil + mount/content verification
  |     -> release manifest
  |     -> distributionTrust=development
  |     -> releaseEligible=false
  |     -> update-contract tests
  |
  +-- certification lane (deferred until credentials exist)
        -> Developer ID Application signing
        -> Hardened Runtime verification
        -> Gatekeeper assessment
        -> Apple notarization
        -> stapling
        -> Developer ID-signed DMG
        -> DMG notarization + stapling
        -> certified release manifest
        -> releaseEligible=true
        -> production update metadata
        -> explicit release publication
```

A development artifact cannot become production merely by changing JSON. The certified release-manifest generator requires certification evidence bound to the same commit, architecture, filename, and SHA-256 digest.

## Build a development DMG

A development DMG is useful for packaging QA without Apple credentials. Build a local app first, then create the image explicitly in development mode:

```bash
npm ci
npm run build:macos-desktop -- --arch arm64
npm run build:macos-dmg -- \
  --mode development \
  --arch arm64 \
  --version 0.1.0 \
  --app dist/macos/ChatCockpit.app
```

For Intel packaging, use `--arch x64` with an x64 app input.

The output naming contract is:

```text
dist/macos-dmg/development/arm64/ChatCockpit-<version>-macos-arm64.dmg
dist/macos-dmg/development/x64/ChatCockpit-<version>-macos-x64.dmg
```

The builder/verifier checks:

- exact top-level contents: `ChatCockpit.app` plus the Applications-folder symlink;
- expected bundle identifier;
- expected application architecture;
- `hdiutil verify`;
- read-only mount inspection;
- SHA-256 calculation.

A development DMG always reports:

```text
distributionTrust=development
releaseEligible=false
```

It is not a production release.

## Release manifest trust contract

`generate:macos-release-manifest` produces a public-safe manifest containing only release metadata and artifact filenames/hashes. It does not store certificate exports, Apple account credentials, private keys, or machine paths.

Development mode is always fail-closed:

```text
distributionTrust=development
releaseEligible=false
certification=<absent>
```

Certified mode is accepted only when evidence is bound to the same artifact and all production gates are true:

```text
developerIdSigned=true
hardenedRuntime=true
gatekeeperAccepted=true
notarizationAccepted=true
appStapled=true
dmgVerified=true
dmgNotarized=true
dmgStapled=true
```

The evidence also binds:

```text
commit
architecture
kind
dmg filename
sha256
```

If any required field is missing, false, mismatched, or belongs to another artifact, the generator rejects the certified manifest.

## Manual Verified Update v1

The desktop Settings window exposes an **Updates** section with:

- current app version;
- current build number;
- **Check for Updates**;
- `Up to date`, `Version <x> available`, or `Unable to check` state;
- **Download Update** only when a certified, release-eligible update is available for the current architecture and supported macOS version.

The default public metadata endpoint is the latest GitHub release asset named:

```text
macos-update.json
```

The checker requires:

- HTTPS metadata and release/download URLs;
- supported schema/version syntax;
- `releaseEligible=true`;
- SHA-256 metadata;
- one unique artifact per architecture;
- exact architecture-specific DMG filename;
- current macOS satisfying `minimumMacOSVersion`.

Update checks are **explicit only**. Constructing or launching the desktop app does not automatically fetch update metadata.

**Download Update** opens the already-validated HTTPS release asset URL in the system browser. ChatCockpit does not silently download, replace, patch, relaunch, stop, or restart the application or its service stack.

## Production certification workflow contract

`.github/workflows/macos-release.yml` is intentionally separate from ordinary verification.

It is:

- `workflow_dispatch` only;
- tag-only at runtime (`v<version>` must match the supplied version);
- pinned to the exact triggering `GITHUB_SHA`;
- scoped to the `macos-production-release` GitHub Environment;
- fail-closed before release builds if any required credential reference is absent;
- permitted to publish assets only after all app/DMG/manifest/update gates succeed;
- required to delete the ephemeral keychain and temporary credential files with an always-run cleanup step.

Ordinary PR/push verification does not read Apple release secrets.

### Future GitHub Environment secrets

When Apple production certification is intentionally enabled, configure these values in the protected `macos-production-release` environment rather than committing them:

```text
CHATCOCKPIT_MACOS_CERTIFICATE_P12_BASE64
CHATCOCKPIT_MACOS_CERTIFICATE_PASSWORD
CHATCOCKPIT_SIGNING_IDENTITY
CHATCOCKPIT_NOTARY_API_KEY_BASE64
CHATCOCKPIT_NOTARY_KEY_ID
CHATCOCKPIT_NOTARY_ISSUER_ID
```

These names are references only. Never place real certificate bytes, private keys, passwords, Apple account credentials, or exported keychains in the repository, documentation, issue comments, or CI logs.

The workflow imports the Developer ID identity into an ephemeral file-based keychain and stores a `notarytool` credential profile in the same temporary keychain. The release scripts receive only identity/profile/keychain references.

## Production workflow gate order

Once valid credentials exist, the release workflow is designed to run:

```text
explicit versioned tag + exact SHA
  -> credential preflight
  -> ephemeral keychain
  -> arm64/x64 distribution app build
  -> Developer ID app signing
  -> app notarization + stapling + Gatekeeper verification
  -> production-mode DMG build
  -> Developer ID DMG signing
  -> DMG notarization + stapling
  -> hdiutil + Gatekeeper + mounted-app verification
  -> hash-bound certification evidence
  -> certified release manifest
  -> production macos-update.json
  -> final manifest re-verification
  -> explicit GitHub Release publication
  -> always-run credential cleanup
```

No earlier stage may publish a production asset.

## Apple certification boundary

Apple's current external-distribution model uses Developer ID and notarization for software distributed outside the Mac App Store. ChatCockpit's production workflow follows that model and uses `notarytool`; it does not use the deprecated `altool` notarization path.

References:

- [Developer ID](https://developer.apple.com/support/developer-id/)
- [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

These references describe the future certification lane. Their presence does not imply that ChatCockpit has already completed that lane.

## Useful secretless verification

```bash
npm run verify:macos-signing-contract
npm run verify:macos-notarization
npm run verify:macos-dmg
npm run verify:macos-release-manifest
npm run verify:macos-update-manifest
npm run verify:macos-manual-update
npm run verify:macos-release-workflow
swift test --package-path desktop/macos
```

These checks can and should remain green without Apple release credentials. Real Developer ID, Gatekeeper, notarization, and stapling proof is a separate future certification event.
