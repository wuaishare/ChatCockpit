# TokenPilot Packaging Roadmap

Current release packaging is source-first. The next packaging milestones are:

1. Curated source archive with checksum.
2. macOS menu-bar wrapper that starts/stops the existing Node control plane and runner.
3. Optional bundled Node runtime for users who do not want to install Node manually.
4. Native installer signing and notarization.
5. Later Windows/Linux equivalents after the macOS local workflow is stable.

Recommended direction for the next milestone: keep the existing Node service, add a small macOS menu-bar wrapper, and avoid hiding security-critical settings such as exposed mode, bearer token, and repo allowlist.
