import AppKit
import SwiftUI
import TokenPilotDesktopCore

struct MenuBarContentView: View {
    @ObservedObject var model: DesktopAppModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: model.snapshot.overallState.systemImage)
                    .font(.title3.weight(.semibold))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("TokenPilot")
                        .font(.headline)
                    Text(model.snapshot.overallState.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if model.isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 7) {
                compactStatus("Control Plane", model.snapshot.lifecycle.controlPlane)
                compactStatus("Runner", model.snapshot.lifecycle.runner)
                compactStatus("Process Supervisor", model.snapshot.lifecycle.processSupervisor)
            }

            Divider()

            Button("Open TokenPilot") {
                model.openCockpit()
            }
            .disabled(model.snapshot.cockpitURL == nil)

            Button("Open Status Window") {
                openWindow(id: "status")
            }

            if model.runtimeConflict != nil {
                Button("Runtime Conflict — Review Settings") {
                    openSettings()
                }
            } else {
                switch model.snapshot.overallState {
                case .setupRequired:
                    Button(model.setupActionTitle) {
                        model.chooseSetupLocationFromPanel()
                    }
                case .stopped:
                    Button("Start Services") {
                        Task { await model.start() }
                    }
                    .disabled(model.isRefreshing)
                case .degraded, .ready:
                    Button("Restart Services") {
                        Task { await model.restart() }
                    }
                    .disabled(model.isRefreshing)

                    Button("Stop Services") {
                        Task { await model.stop() }
                    }
                    .disabled(model.isRefreshing)
                }
            }

            Divider()

            Button("Settings…") {
                openSettings()
            }
            .keyboardShortcut(",", modifiers: .command)

            Button("Quit TokenPilot") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q", modifiers: .command)
        }
        .padding(14)
        .frame(width: 290)
        .task {
            await model.refresh()
        }
    }

    private func compactStatus(_ title: String, _ state: RuntimeComponentState) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Label(state.displayName, systemImage: state.systemImage)
                .labelStyle(.titleAndIcon)
                .font(.caption)
        }
    }
}
