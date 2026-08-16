import SwiftUI
import TokenPilotDesktopCore

struct SettingsView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        Form {
            Section(DesktopL10n.string("Distribution")) {
                LabeledContent(DesktopL10n.string("Mode")) {
                    Text(model.distributionModeText)
                }
                LabeledContent(DesktopL10n.string("Runtime")) {
                    Text(model.runtimeVersionText)
                }
                LabeledContent(DesktopL10n.string("Architecture")) {
                    Text(model.runtimeArchitectureText)
                }
                LabeledContent(DesktopL10n.string("State")) {
                    Text(model.stateLocationText)
                }

                HStack {
                    Button(DesktopL10n.string("Packaged Mode")) {
                        Task { await model.usePackagedMode() }
                    }
                    .disabled(!model.packagedModeAvailable || model.distributionMode == .packaged)

                    Button(DesktopL10n.string("Developer Mode")) {
                        Task { await model.useDeveloperMode() }
                    }
                    .disabled(model.distributionMode == .source)
                }
            }

            Section(DesktopL10n.string("Updates")) {
                LabeledContent(DesktopL10n.string("App version")) {
                    Text(model.currentAppVersionText)
                }
                LabeledContent(DesktopL10n.string("Build")) {
                    Text(model.currentAppBuildText)
                }
                LabeledContent(DesktopL10n.string("Status")) {
                    Text(model.updateStatusText)
                }

                HStack {
                    Button(
                        model.isCheckingForUpdates
                            ? DesktopL10n.string("Checking…")
                            : DesktopL10n.string("Check for Updates")
                    ) {
                        Task { await model.checkForUpdates() }
                    }
                    .disabled(model.isCheckingForUpdates)

                    if model.updateAvailable {
                        Button(DesktopL10n.string("Download Update")) {
                            model.openAvailableUpdate()
                        }
                    }
                }

                Text(
                    DesktopL10n.string(
                        "Update checks are explicit and read public release metadata only. ChatCockpit never replaces the app, stops services, or restarts the runtime automatically. Download Update is shown only for a certified release marked eligible for distribution."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if model.distributionMode == .packaged {
                Section(DesktopL10n.string("Workspaces")) {
                    if model.packagedWorkspaces.isEmpty {
                        LabeledContent(DesktopL10n.string("Primary Workspace")) {
                            Text(DesktopL10n.string("Not selected"))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.packagedWorkspaces) { workspace in
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 8) {
                                    Text(verbatim: workspace.repoID)
                                        .font(.system(.body, design: .monospaced))
                                    if workspace.isPrimary {
                                        Text(DesktopL10n.string("Primary"))
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary, in: Capsule())
                                    }
                                    if !workspace.isAvailable {
                                        Label(DesktopL10n.string("Unavailable"), systemImage: "exclamationmark.triangle")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }

                                Text((workspace.url.path as NSString).abbreviatingWithTildeInPath)
                                    .font(.caption)
                                    .foregroundStyle(workspace.isAvailable ? .secondary : .tertiary)
                                    .textSelection(.enabled)
                                    .lineLimit(2)

                                if !workspace.isPrimary {
                                    HStack(spacing: 8) {
                                        Button(DesktopL10n.string("Make Primary")) {
                                            Task { await model.makeWorkspacePrimary(workspace.repoID) }
                                        }
                                        .disabled(!workspace.isAvailable || model.isRefreshing)

                                        Button(DesktopL10n.string("Remove"), role: .destructive) {
                                            model.confirmAndRemoveWorkspace(workspace)
                                        }
                                        .disabled(model.isRefreshing)
                                    }
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    HStack {
                        Button(
                            model.packagedWorkspaces.isEmpty
                                ? DesktopL10n.string("Choose Primary Workspace…")
                                : DesktopL10n.string("Add Workspace…")
                        ) {
                            if model.packagedWorkspaces.isEmpty {
                                model.chooseWorkspaceFromPanel()
                            } else {
                                model.addWorkspaceFromPanel()
                            }
                        }
                        Button(DesktopL10n.string("Refresh Workspaces")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.isRefreshing)
                    }

                    Text(
                        DesktopL10n.string(
                            "The primary workspace is the default project used to bootstrap Packaged Mode. Additional authorized workspaces keep stable repository IDs. Adding, removing, or changing the primary workspace never starts, stops, or restarts the Runtime automatically."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Section(DesktopL10n.string("Existing Setup")) {
                    Button(DesktopL10n.string("Import Existing Setup…")) {
                        model.importExistingSetupFromPanel()
                    }
                    .disabled(model.isRefreshing)

                    Text(
                        DesktopL10n.string(
                            "Import previews only workspace mappings and non-secret local runtime settings. Bearer tokens, OAuth tokens, Process Supervisor tokens, provider credentials, and cookies are never migrated. Existing source files are read only."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Section(DesktopL10n.string("Developer Source")) {
                    LabeledContent(DesktopL10n.string("Current checkout")) {
                        Text(model.selectedRootDisplayPath)
                            .textSelection(.enabled)
                            .foregroundStyle(model.selectedRootURL == nil ? .secondary : .primary)
                    }

                    HStack {
                        Button(DesktopL10n.string("Choose Source…")) {
                            model.chooseRootFromPanel()
                        }
                        Button(DesktopL10n.string("Revalidate")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.selectedRootURL == nil || model.isRefreshing)
                        Button(DesktopL10n.string("Forget"), role: .destructive) {
                            model.clearRoot()
                        }
                        .disabled(model.selectedRootURL == nil)
                    }
                }
            }

            Section(DesktopL10n.string("Local Runtime")) {
                LabeledContent(DesktopL10n.string("Endpoint")) {
                    Text(verbatim: model.endpointText)
                        .textSelection(.enabled)
                }
                LabeledContent(DesktopL10n.string("Node")) {
                    Text(model.nodeVersionText)
                }
                LabeledContent(
                    model.distributionMode == .packaged
                        ? DesktopL10n.string("Bundled Node")
                        : DesktopL10n.string("Minimum Node")
                ) {
                    Text(model.distributionMode == .packaged ? "v24.18.1 exact" : "v22.13.0")
                }
                LabeledContent(DesktopL10n.string("Status")) {
                    Label(
                        model.snapshot.overallState.displayName,
                        systemImage: model.snapshot.overallState.systemImage
                    )
                }

                HStack {
                    Button(DesktopL10n.string("Open Local Cockpit")) {
                        model.openLocalCockpit()
                    }
                    .disabled(model.snapshot.localCockpitURL == nil)

                    if model.snapshot.publicCockpitURL != nil {
                        Button(DesktopL10n.string("Open Public Cockpit")) {
                            model.openPublicCockpit()
                        }
                    }
                }
            }

            Section(DesktopL10n.string("Security & Access")) {
                LabeledContent(DesktopL10n.string("Runtime mode")) {
                    Text(
                        model.snapshot.configuration.exposed
                            ? DesktopL10n.string("Exposed")
                            : DesktopL10n.string("Local only")
                    )
                }

                LabeledContent(DesktopL10n.string("Web Owner")) {
                    if let status = model.operatorSecurityStatus {
                        Text(
                            status.configured
                                ? (status.username ?? DesktopL10n.string("Configured"))
                                : DesktopL10n.string("Not configured")
                        )
                    } else {
                        Text(DesktopL10n.string("Unavailable"))
                            .foregroundStyle(.secondary)
                    }
                }

                if let status = model.operatorSecurityStatus, status.configured {
                    LabeledContent(DesktopL10n.string("Active Web sessions")) {
                        Text(verbatim: String(status.activeSessionCount))
                    }
                }

                HStack {
                    Button(
                        DesktopL10n.string(
                            model.operatorSecurityStatus?.configured == true
                                ? "Manage Owner…"
                                : "Set Owner…"
                        )
                    ) {
                        model.setOwnerPasswordFromPanel()
                    }

                    Button(DesktopL10n.string("Revoke Web Sessions"), role: .destructive) {
                        Task { await model.revokeOwnerSessions() }
                    }
                    .disabled(model.operatorSecurityStatus?.configured != true)
                }

                Divider()

                LabeledContent(DesktopL10n.string("Machine API token")) {
                    if let token = model.revealedMachineApiToken {
                        Text(verbatim: token)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                    } else if let status = model.machineApiTokenStatus, status.configured {
                        Text(verbatim: status.fingerprint ?? DesktopL10n.string("Configured"))
                            .font(.system(.body, design: .monospaced))
                    } else {
                        Text(DesktopL10n.string("Not configured"))
                            .foregroundStyle(.secondary)
                    }
                }

                HStack {
                    if model.revealedMachineApiToken == nil {
                        Button(DesktopL10n.string("Reveal Token")) {
                            Task { await model.revealMachineApiToken() }
                        }
                        .disabled(model.machineApiTokenStatus?.configured != true)
                    } else {
                        Button(DesktopL10n.string("Hide Token")) {
                            model.hideMachineApiToken()
                        }
                    }

                    Button(DesktopL10n.string("Copy Token")) {
                        Task { await model.copyMachineApiToken() }
                    }
                    .disabled(model.machineApiTokenStatus?.configured != true)

                    Button(DesktopL10n.string("Rotate Token…"), role: .destructive) {
                        Task { await model.rotateMachineApiToken() }
                    }
                }

                Text(
                    DesktopL10n.string(
                        "Web Owner sessions, machine API credentials, and ChatGPT OAuth are separate authorities. Token reveal is temporary and stays in memory only. Rotating the machine token restarts services only when they are already running; stopped services stay stopped. Web Owner and ChatGPT OAuth sessions are not revoked."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let conflict = model.runtimeConflict {
                Section(DesktopL10n.string("Runtime Conflict")) {
                    Label(model.localizedConflictMessage(conflict), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        DesktopL10n.string(
                            "ChatCockpit will not stop, restart, replace, or take over the existing runtime automatically. Resolve it explicitly in its current mode, then refresh Packaged Mode."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let message = model.lastUserMessage {
                Section(DesktopL10n.string("Attention")) {
                    Label(message, systemImage: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 590, height: 650)
        .padding(.top, 6)
        .task {
            await model.refreshSecurity()
        }
    }
}
