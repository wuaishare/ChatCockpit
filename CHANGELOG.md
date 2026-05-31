# Changelog

All notable changes to TokenPilot will be documented in this file.

This project uses prerelease tags while the local-first workflow is still in alpha.

## 0.1.0-alpha.1 - Unreleased

### Added

- ChatGPT-first dual-mode workflow positioning: GPT direct-drive for frequent small changes and Codex async runs for complex repository work.
- Local operator Web UI MVP for health, jobs, GPT Helper configuration, artifacts, and controlled job actions.
- Write-side GPT Actions APIs for file write/edit, directory listing, code search, allowlisted shell checks, and public-safe Git operations.
- `createCodexRun` job flow with local runner execution, optional worktree isolation, Codex review, diffs, summaries, and public-safe artifacts.
- Current-tree and history privacy scanning helpers for public repository governance.
- Dual-language README assets and public documentation for the alpha workflow.

### Changed

- Public docs now keep private deployment domains, reverse-proxy details, and GPT Builder operating notes out of the public repository.
- GPT config versioning is based on the latest Git commit timestamp so it stays stable between requests.
- Public HTTP and artifact surfaces filter local paths, runtime state, env files, and other public-unsafe data.

### Security

- Exposed-mode write APIs require bearer auth.
- `runShell` remains allowlisted and bounded, but is documented as a high-trust local operator API.
- Git diffs, commits, and Codex artifacts are constrained to public-safe paths.

### Known Limitations

- Full HTTPS / Custom GPT Actions end-to-end production loop is still under validation.
- The first Web UI is an operator console, not a public management platform.
- Setup Wizard, provider adapters, template library, and real examples are not yet included.
- Release packaging is source-preview oriented; installer-grade packages are future work.
