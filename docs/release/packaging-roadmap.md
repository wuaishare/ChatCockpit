# ChatCockpit Packaging Roadmap

ChatCockpit remains source-friendly, while the macOS desktop path now has a self-contained runtime layer around the same authoritative Node/TypeScript control plane.

## Packaging milestones

1. **Curated source archive with checksum — complete.**
2. **macOS native operator shell — Phase 1 complete.**
   - normal foreground SwiftUI app with a primary Status window and Dock presence;
   - retained menu-bar quick-control surface plus compact Status / Settings windows;
   - bounded source-root discovery for Developer Mode;
   - existing `scripts/macos-manage-local-server.sh` lifecycle contract;
   - local health aggregation and Open Cockpit;
   - locally verifiable unsigned `.app` build.
3. **Self-contained macOS runtime — Phase 2 implemented.**
   - exact bundled Node `24.18.1` with reviewed official artifact hashes;
   - separate arm64 and x64 runtime payloads;
   - production dependencies assembled from a clean lockfile install;
   - versioned immutable runtime deployment under Application Support;
   - writable state/config separated from the runtime and user workspace;
   - selected project workspace semantics instead of treating the app/runtime as a repository;
   - Packaged Mode starts without system Node/npm and without a ChatCockpit source checkout;
   - Developer Mode remains compatible with system Node `>=22.13.0` and global `~/.chatcockpit` state, separate from the selected checkout;
   - non-destructive Existing Setup import excludes bearer/OAuth/supervisor/provider/cookie secrets;
   - LaunchAgent ownership and port-conflict protection prevent automatic takeover of another runtime;
   - native-architecture packaged runtime live proof plus other-architecture static payload verification.
4. **macOS distribution engineering — secretless lane implemented; Apple certification deferred.**
   - full Xcode distribution boundary and hardened-runtime policy contract;
   - fail-closed Developer ID signing and `notarytool` / stapling contracts;
   - explicit `development | production` DMG builder with arm64/x64 names;
   - real development DMG create → verify → read-only mount/content/hash proof;
   - trust-aware release manifest with `distributionTrust` and `releaseEligible` invariants;
   - public update metadata contract plus explicit Manual Verified Update v1 UI;
   - tag-only credentialed GitHub release workflow contract with ephemeral keychain cleanup;
   - **real Developer ID / Gatekeeper / notarization / production DMG proof remains deferred until Apple Developer Program credentials are available.**
5. **Headless Device Agent packaging and public bootstrap contract — Phases 11.1 and 11.2 implemented for macOS.**
   - self-contained portable bundle reuses the verified macOS Runtime payload and exact bundled Node `24.18.1`;
   - target Macs do not require system Node/npm or a ChatCockpit source checkout;
   - one restricted `chatcockpit-device` entrypoint exposes Device Agent enrollment/routing plus bounded Device Agent and Runtime service lifecycle operations;
   - headless persistent Agent/Runtime start is fail-closed until a canonical external development workspace is explicitly configured; the embedded Runtime cannot silently become the workspace;
   - ordinary engineering packages remain `distributionTrust=development`, `releaseEligible=false`; release packaging is a separate explicit mode and refuses dirty build provenance;
   - the release publisher requires matching arm64/x64 source revision and bundled Node version, copies only checksum-verified archives, and emits a checksum-bound public distribution manifest;
   - the Hub serves only the exact manifest and declared arm64/x64 archives from a configured distribution directory; undeclared files are not exposed by the public download surface;
   - Web onboarding projects `nativePackage.available=true` only when the local distribution validates as release-eligible **and** the canonical HTTPS public route has current verification evidence;
   - HTTPS and SHA-256 provide channel/integrity controls for this bootstrap contract; they do **not** claim Apple Developer ID signing, notarization, stapling, or publisher-signature authenticity.
6. **Later Windows/Linux equivalents** after the macOS packaging and distribution contract is stable.

## Architecture rule

Keep the existing ChatCockpit Node control plane authoritative. The native macOS app is an operator shell and packaged-runtime host, not a second implementation of Continuity, MCP, OAuth, Codex, Resource Center, approvals, mutations, Runner, or Process Supervisor behavior.

Packaged distribution also keeps these roots distinct:

```text
app bundle payload != deployed runtime != writable state != user workspace
```

The desktop shell must not hide security-critical state, display secret values, or automatically replace a runtime owned by another mode. Quitting the GUI remains separate from explicitly stopping ChatCockpit services.

## Current distribution honesty

ChatCockpit now has two intentionally separate distribution lanes.

The **secretless engineering lane** can build and verify development DMGs, generate checksummed release manifests, validate public update metadata, and expose an explicit Manual Verified Update UI. These capabilities prove packaging and update-contract behavior, not publisher authenticity. Development manifests are permanently constrained to:

```text
distributionTrust=development
releaseEligible=false
```

The **Device Agent bootstrap lane** can additionally build release-eligible self-contained macOS Device Agent archives from a clean source revision and publish a checksummed dual-architecture manifest for a configured Hub download directory. This `distributionTrust=release` value means the Device Agent artifact passed ChatCockpit's release eligibility contract; it is not a substitute for Apple code signing or notarization. The Hub remains fail-closed when the directory, manifest, archive integrity, canonical HTTPS origin, or public-route verification is absent or invalid.

The **certification lane** remains deferred. Until a real Developer ID Application identity and Apple notarization credentials are available and the credentialed workflow completes successfully, ChatCockpit Desktop must not be described as:

- Developer ID signed for public distribution;
- Apple notarized or stapled;
- Gatekeeper-accepted production distribution;
- a production/release-eligible `.dmg`;
- silently or automatically updating.

Manual Verified Update v1 is deliberately not a silent updater. The app checks public metadata only after an explicit operator action and exposes **Download Update** only when that metadata validates as `releaseEligible=true`; it does not replace the app or stop/restart ChatCockpit services.
