import SwiftUI

struct TokenPilotDesktopApp: App {
    @StateObject private var model = DesktopAppModel()

    var body: some Scene {
        MenuBarExtra("TokenPilot", systemImage: model.snapshot.overallState.systemImage) {
            MenuBarContentView(model: model)
        }
        .menuBarExtraStyle(.window)

        Window("TokenPilot Status", id: "status") {
            StatusView(model: model)
        }
        .defaultSize(width: 620, height: 500)

        Settings {
            SettingsView(model: model)
        }
    }
}
