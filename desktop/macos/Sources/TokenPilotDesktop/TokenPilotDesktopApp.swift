import SwiftUI
import TokenPilotDesktopCore

struct TokenPilotDesktopApp: App {
    @StateObject private var model = DesktopAppModel()

    var body: some Scene {
        MenuBarExtra(ProductIdentity.current.displayName, systemImage: model.snapshot.overallState.systemImage) {
            MenuBarContentView(model: model)
        }
        .menuBarExtraStyle(.window)

        Window("\(ProductIdentity.current.displayName) Status", id: "status") {
            StatusView(model: model)
        }
        .defaultSize(width: 620, height: 500)

        Settings {
            SettingsView(model: model)
        }
    }
}
