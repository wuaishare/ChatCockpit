import SwiftUI
import TokenPilotDesktopCore

struct SettingsView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        Form {
            Section("TokenPilot Root") {
                LabeledContent("Current folder") {
                    Text(model.selectedRootDisplayPath)
                        .textSelection(.enabled)
                        .foregroundStyle(model.selectedRootURL == nil ? .secondary : .primary)
                }

                HStack {
                    Button("Choose Folder…") {
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

            Section("Local Runtime") {
                LabeledContent("Endpoint") {
                    Text("\(model.snapshot.configuration.host):\(model.snapshot.configuration.port)")
                        .textSelection(.enabled)
                }
                LabeledContent("Node") {
                    Text(model.nodeVersionText)
                }
                LabeledContent("Minimum Node") {
                    Text("v22.13.0")
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

            if let message = model.lastUserMessage {
                Section("Attention") {
                    Label(message, systemImage: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 560, height: 430)
        .padding(.top, 6)
    }
}
