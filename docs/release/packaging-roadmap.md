# TokenPilot Packaging Roadmap

TokenPilot remains source-friendly, while the macOS desktop path now has a self-contained runtime layer around the same authoritative Node/TypeScript control plane.

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
   - Packaged Mode starts without system Node/npm and without a TokenPilot source checkout;
   - Developer Mode remains compatible with system Node `>=22.13.0` and checkout-local `.tokenpilot` state;
   - non-destructive Existing Setup import excludes bearer/OAuth/supervisor/provider/cookie secrets;
   - LaunchAgent ownership and port-conflict protection prevent automatic takeover of another runtime;
   - native-architecture packaged runtime live proof plus other-architecture static payload verification.
4. **Signed macOS distribution — next gate.**
   - full Xcode build/distribution pipeline;
   - Developer ID signing;
   - hardened runtime;
   - notarization;
   - `.app` / `.dmg` release assets;
   - update strategy.
5. **Later Windows/Linux equivalents** after the macOS packaging and distribution contract is stable.

## Architecture rule

Keep the existing TokenPilot Node control plane authoritative. The native macOS app is an operator shell and packaged-runtime host, not a second implementation of Continuity, MCP, OAuth, Codex, Resource Center, approvals, mutations, Runner, or Process Supervisor behavior.

Packaged distribution also keeps these roots distinct:

```text
app bundle payload != deployed runtime != writable state != user workspace
```

The desktop shell must not hide security-critical state, display secret values, or automatically replace a runtime owned by another mode. Quitting the GUI remains separate from explicitly stopping TokenPilot services.

## Current distribution honesty

Phase 2 produces a **self-contained but still local unsigned app**. Runtime integrity hashes prove payload consistency/corruption detection; they do not provide publisher authenticity.

Until the next gate is complete, TokenPilot Desktop must not be described as:

- Developer ID signed;
- hardened-runtime distributed;
- Apple notarized;
- App Store ready;
- a production `.dmg` release;
- automatically updating.

Those properties belong to the signed macOS distribution milestone, not to Phase 2.
