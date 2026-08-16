import SwiftUI
import TokenPilotDesktopCore

struct TokenPilotDesktopApp: App {
    @StateObject private var model = DesktopAppModel()

    var body: some Scene {
        Window(DesktopL10n.string("ChatCockpit Status"), id: "status") {
            StatusView(model: model)
        }
        .defaultSize(width: 720, height: 640)

        MenuBarExtra(ProductIdentity.current.displayName, systemImage: model.snapshot.overallState.systemImage) {
            MenuBarContentView(model: model)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(model: model)
        }
    }
}
