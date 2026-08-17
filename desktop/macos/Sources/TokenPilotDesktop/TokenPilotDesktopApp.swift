import AppKit
import SwiftUI
import TokenPilotDesktopCore

@MainActor
final class DesktopApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let application = notification.object as? NSApplication else { return }
        DispatchQueue.main.async {
            self.presentMainWindow(in: application)
        }
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows: Bool
    ) -> Bool {
        if !hasVisibleWindows {
            presentMainWindow(in: sender)
        }
        return true
    }

    private func presentMainWindow(in application: NSApplication) {
        let title = ProductIdentity.current.displayName
        if let mainWindow = application.windows.first(where: { $0.title == title }) {
            mainWindow.makeKeyAndOrderFront(nil)
            application.activate(ignoringOtherApps: true)
            return
        }

        guard let windowMenuItem = application.windowsMenu?.item(withTitle: title),
              let action = windowMenuItem.action else {
            return
        }
        _ = application.sendAction(action, to: windowMenuItem.target, from: windowMenuItem)
        application.activate(ignoringOtherApps: true)
    }
}

struct TokenPilotDesktopApp: App {
    @NSApplicationDelegateAdaptor(DesktopApplicationDelegate.self) private var applicationDelegate
    @StateObject private var model = DesktopAppModel()
    @State private var mainSection: MainAppSection? = .overview

    var body: some Scene {
        Window(ProductIdentity.current.displayName, id: "main") {
            MainAppView(model: model, selection: $mainSection)
                .onOpenURL { url in
                    model.handleDeepLink(url)
                }
        }
        .defaultSize(width: 980, height: 700)

        MenuBarExtra(ProductIdentity.current.displayName, systemImage: model.snapshot.overallState.systemImage) {
            MenuBarContentView(model: model, mainSection: $mainSection)
        }
        .menuBarExtraStyle(.window)

        Settings {
            AppPreferencesView(mainSection: $mainSection)
        }
    }
}

private struct AppPreferencesView: View {
    @Binding var mainSection: MainAppSection?
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(DesktopL10n.string("App Preferences"), systemImage: "gearshape")
                .font(.title3.weight(.semibold))

            Text(
                DesktopL10n.string(
                    "Runtime, workspace, access, security, integrations, updates, and diagnostics now live in the main ChatCockpit window. This Settings window is reserved for app-only preferences."
                )
            )
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            AccessibleTextActionButton(
                title: DesktopL10n.string("Open ChatCockpit"),
                defaultAction: true
            ) {
                mainSection = .overview
                DesktopScenePresentation.present {
                    openWindow(id: "main")
                }
            }
            .frame(width: 140, height: 28)

            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(width: 460, height: 220)
    }
}

struct AccessibleTextActionButton: NSViewRepresentable {
    let title: String
    let defaultAction: Bool
    let disabled: Bool
    let action: () -> Void

    init(
        title: String,
        defaultAction: Bool = false,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.defaultAction = defaultAction
        self.disabled = disabled
        self.action = action
    }

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func invoke() {
            action()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> NSButton {
        let button = NSButton(
            title: title,
            target: context.coordinator,
            action: #selector(Coordinator.invoke)
        )
        button.bezelStyle = .rounded
        button.focusRingType = .default
        button.refusesFirstResponder = false
        configure(button, coordinator: context.coordinator)
        return button
    }

    func updateNSView(_ button: NSButton, context: Context) {
        configure(button, coordinator: context.coordinator)
    }

    private func configure(_ button: NSButton, coordinator: Coordinator) {
        coordinator.action = action
        button.title = title
        button.toolTip = title
        button.isEnabled = !disabled
        button.keyEquivalent = defaultAction ? "\r" : ""
        button.keyEquivalentModifierMask = []
        button.setAccessibilityLabel(title)
        button.setAccessibilityHelp(title)
        button.setAccessibilityRole(.button)
    }
}
