# TokenPilot Packaging Roadmap

TokenPilot remains source-first, but the first native desktop milestone is now implemented as a thin macOS operator shell around the existing Node runtime.

## Packaging milestones

1. **Curated source archive with checksum — complete.**
2. **macOS native operator shell — Phase 1.**
   - SwiftUI menu-bar surface;
   - compact Status / Settings windows;
   - bounded TokenPilot-root discovery and manual selection;
   - existing Node `>=22.13.0` runtime;
   - existing `scripts/macos-manage-local-server.sh` lifecycle contract;
   - local health aggregation and Open Cockpit;
   - locally verifiable unsigned `.app` build.
3. **Self-contained macOS runtime.**
   - optional bundled Node runtime for users who do not want to install Node manually;
   - packaged-runtime discovery and migration from source-checkout mode.
4. **Signed macOS distribution.**
   - full Xcode build/distribution pipeline;
   - Developer ID signing;
   - hardened runtime;
   - notarization;
   - `.app` / `.dmg` release assets;
   - update strategy.
5. **Later Windows/Linux equivalents** after the macOS local workflow and packaging contract are stable.

## Architecture rule

Keep the existing TokenPilot Node control plane authoritative. The native macOS app is an operator shell, not a second implementation of Continuity, MCP, OAuth, Codex, Resource Center, approvals, mutations, Runner, or Process Supervisor behavior.

The desktop shell must not hide security-critical state such as local/exposed mode, and it must not display secret values. Quitting the GUI is separate from explicitly stopping TokenPilot services.

## Current distribution honesty

The Phase 1 build is a **local unsigned app**. It must not be described as signed, notarized, App Store ready, or a production `.dmg` release until the later distribution gate is completed with the required Xcode and Apple signing/notarization setup.
