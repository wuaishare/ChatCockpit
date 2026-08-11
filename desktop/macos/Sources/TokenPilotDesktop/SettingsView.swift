import SwiftUI
import TokenPilotDesktopCore

struct SettingsView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        Form {
            Section("Distribution") {
                LabeledContent("Mode") {
                    Text(model.distributionModeText)
                }
                LabeledContent("Runtime") {
                    Text(model.runtimeVersionText)
                }
                LabeledContent("Architecture") {
                    Text(model.runtimeArchitectureText)
                }
                LabeledContent("State") {
                    Text(model.stateLocationText)
                }

                HStack {
                    Button("Packaged Mode") {
                        Task { await model.usePackagedMode() }
                    }
                    .disabled(!model.packagedModeAvailable || model.distributionMode == .packaged)

                    Button("Developer Mode") {
                        Task { await model.useDeveloperMode() }
                    }
                    .disabled(model.distributionMode == .source)
                }
            }

            if model.distributionMode == .packaged {
                Section("Workspace") {
                    LabeledContent("Current project") {
                        Text(model.selectedWorkspaceDisplayPath)
                            .textSelection(.enabled)
                            .foregroundStyle(model.selectedWorkspaceURL == nil ? .secondary : .primary)
                    }

                    HStack {
                        Button("Choose Workspace…") {
                            model.chooseWorkspaceFromPanel()
                        }
                        Button("Revalidate") {
                            Task { await model.refresh() }
                        }
                        .disabled(model.selectedWorkspaceURL == nil || model.isRefreshing)
                        Button("Forget", role: .destructive) {
                            model.clearWorkspace()
                        }
                        .disabled(model.selectedWorkspaceURL == nil)
                    }

                    Text("The packaged TokenPilot runtime and Application Support state remain separate from the selected project workspace.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Section("Existing Setup") {
                    Button("Import Existing Setup…") {
                        model.importExistingSetupFromPanel()
                    }
                    .disabled(model.isRefreshing)

                    Text("Import previews only workspace mappings and non-secret local runtime settings. Bearer tokens, OAuth tokens, Process Supervisor tokens, provider credentials, and cookies are never migrated. Existing source files are read only.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Section("Developer Source") {
                    LabeledContent("Current checkout") {
                        Text(model.selectedRootDisplayPath)
                            .textSelection(.enabled)
                            .foregroundStyle(model.selectedRootURL == nil ? .secondary : .primary)
                    }

                    HStack {
                        Button("Choose Source…") {
                            model.chooseRootFromPanel()
                        }
                        Button("Revalidate") {
                            Task { await model.refresh() }
                        }
                        .disabled(model.selectedRootURL == nil || model.isRefreshing)
                        Button("Forget", role: .destructive) {
                            model.clearRoot()
                        }
                        .disabled(model.selectedRootURL == nil)
                    }
                }
            }

            Section("Local Runtime") {
                LabeledContent("Endpoint") {
                    Text("\(model.snapshot.configuration.host):\(model.snapshot.configuration.port)")
                        .textSelection(.enabled)
                }
                LabeledContent("Node") {
                    Text(model.nodeVersionText)
                }
                LabeledContent(model.distributionMode == .packaged ? "Bundled Node" : "Minimum Node") {
                    Text(model.distributionMode == .packaged ? "v24.18.1 exact" : "v22.13.0")
                }
                LabeledContent("Status") {
                    Label(
                        model.snapshot.overallState.displayName,
                        systemImage: model.snapshot.overallState.systemImage
                    )
                }

                Button("Open TokenPilot") {
                    model.openCockpit()
                }
                .disabled(model.snapshot.cockpitURL == nil)
            }

            Section("Security") {
                LabeledContent("Runtime mode") {
                    Text(model.snapshot.configuration.exposed ? "Exposed" : "Local only")
                }
                LabeledContent("API token") {
                    Text(model.snapshot.configuration.apiTokenConfigured ? "Configured" : "Not configured")
                }
                Text("Token values are never displayed by the desktop shell. Remote MCP, OAuth, approvals, and mutation policy remain owned by the existing TokenPilot control plane.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let conflict = model.runtimeConflict {
                Section("Runtime Conflict") {
                    Label(conflict.message, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("TokenPilot will not stop, restart, replace, or take over the existing runtime automatically. Resolve it explicitly in its current mode, then refresh Packaged Mode.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let message = model.lastUserMessage {
                Section("Attention") {
                    Label(message, systemImage: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 590, height: 560)
        .padding(.top, 6)
    }
}
