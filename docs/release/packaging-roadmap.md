# ChatCockpit Packaging Roadmap

ChatCockpit remains source-friendly, while the macOS desktop path now has a self-contained runtime layer around the same authoritative Node/TypeScript control plane.

## Packaging milestones

1. **Curated source archive with checksum — complete.**
2. **macOS native operator shell — Phase 1 complete.**
   - SwiftUI menu-bar surface;
   - compact Status / Settings windows;
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
5. **Later Windows/Linux equivalents** after the macOS packaging and distribution contract is stable.

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

The **certification lane** remains deferred. Until a real Developer ID Application identity and Apple notarization credentials are available and the credentialed workflow completes successfully, ChatCockpit Desktop must not be described as:

- Developer ID signed for public distribution;
- Apple notarized or stapled;
- Gatekeeper-accepted production distribution;
- a production/release-eligible `.dmg`;
- silently or automatically updating.

Manual Verified Update v1 is deliberately not a silent updater. The app checks public metadata only after an explicit operator action and exposes **Download Update** only when that metadata validates as `releaseEligible=true`; it does not replace the app or stop/restart ChatCockpit services.
