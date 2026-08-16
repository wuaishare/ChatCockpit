import AppKit
import SwiftUI
import TokenPilotDesktopCore

struct MenuBarContentView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var mainSection: MainAppSection?
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: model.snapshot.overallState.systemImage)
                    .font(.title3.weight(.semibold))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(ProductIdentity.current.displayName)
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
                compactStatus(
                    DesktopL10n.string("Control Plane"),
                    model.snapshot.lifecycle.controlPlane
                )
                compactStatus(
                    DesktopL10n.string("Runner"),
                    model.snapshot.lifecycle.runner
                )
                compactStatus(
                    DesktopL10n.string("Process Supervisor"),
                    model.snapshot.lifecycle.processSupervisor
                )
            }

            Divider()

            Button(DesktopL10n.string("Open Local Cockpit")) {
                model.openLocalCockpit()
            }
            .disabled(model.snapshot.localCockpitURL == nil)

            if model.snapshot.publicCockpitURL != nil {
                Button(DesktopL10n.string("Open Public Cockpit")) {
                    model.openPublicCockpit()
                }
            }

            Button(DesktopL10n.string("Open ChatCockpit")) {
                openMainWindow(.overview)
            }

            if model.runtimeConflict != nil {
                Button(DesktopL10n.string("Runtime Conflict — Review Runtime")) {
                    openMainWindow(.runtime)
                }
            } else {
                switch model.snapshot.overallState {
                case .setupRequired:
                    Button(model.setupActionTitle) {
                        model.chooseSetupLocationFromPanel()
                    }
                case .stopped:
                    Button(DesktopL10n.string("Start Services")) {
                        Task { await model.start() }
                    }
                    .disabled(model.isRefreshing)
                case .degraded, .ready:
                    Button(DesktopL10n.string("Restart Services")) {
                        Task { await model.restart() }
                    }
                    .disabled(model.isRefreshing)

                    Button(DesktopL10n.string("Stop Services")) {
                        Task { await model.stop() }
                    }
                    .disabled(model.isRefreshing)
                }
            }

            Divider()

            Button(DesktopL10n.string("Access & Security…")) {
                openMainWindow(.accessSecurity)
            }

            Button(DesktopL10n.string("Quit ChatCockpit")) {
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

    private func openMainWindow(_ section: MainAppSection) {
        mainSection = section
        DesktopScenePresentation.present {
            openWindow(id: "main")
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
