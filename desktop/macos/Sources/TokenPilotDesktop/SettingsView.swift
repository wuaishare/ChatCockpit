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
                Section(DesktopL10n.string("Workspace")) {
                    LabeledContent(DesktopL10n.string("Current project")) {
                        Text(model.selectedWorkspaceDisplayPath)
                            .textSelection(.enabled)
                            .foregroundStyle(model.selectedWorkspaceURL == nil ? .secondary : .primary)
                    }

                    HStack {
                        Button(DesktopL10n.string("Choose Workspace…")) {
                            model.chooseWorkspaceFromPanel()
                        }
                        Button(DesktopL10n.string("Revalidate")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.selectedWorkspaceURL == nil || model.isRefreshing)
                        Button(DesktopL10n.string("Forget"), role: .destructive) {
                            model.clearWorkspace()
                        }
                        .disabled(model.selectedWorkspaceURL == nil)
                    }

                    Text(
                        DesktopL10n.string(
                            "The packaged ChatCockpit runtime and Application Support state remain separate from the selected project workspace."
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
                    Text("\(model.snapshot.configuration.host):\(model.snapshot.configuration.port)")
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

                Button(DesktopL10n.string("Open ChatCockpit")) {
                    model.openCockpit()
                }
                .disabled(model.snapshot.cockpitURL == nil)
            }

            Section(DesktopL10n.string("Security")) {
                LabeledContent(DesktopL10n.string("Runtime mode")) {
                    Text(
                        model.snapshot.configuration.exposed
                            ? DesktopL10n.string("Exposed")
                            : DesktopL10n.string("Local only")
                    )
                }
                LabeledContent(DesktopL10n.string("API token")) {
                    Text(
                        model.snapshot.configuration.apiTokenConfigured
                            ? DesktopL10n.string("Configured")
                            : DesktopL10n.string("Not configured")
                    )
                }
                Text(
                    DesktopL10n.string(
                        "Token values are never displayed by the desktop shell. Remote MCP, OAuth, approvals, and mutation policy remain owned by the existing ChatCockpit control plane."
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
    }
}
