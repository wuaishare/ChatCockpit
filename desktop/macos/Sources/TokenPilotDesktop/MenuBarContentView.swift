import AppKit
import SwiftUI
import TokenPilotDesktopCore

struct MenuBarContentView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var mainSection: MainAppSection?
    @Environment(\.openWindow) private var openWindow

    private let metricColumns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            runtimeSection
            activitySection
            accessSection
            attentionAndUpdateSection
            lifecycleToolbar
            navigationSection
        }
        .padding(14)
        .frame(width: 370)
        .task {
            await model.refresh()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: model.snapshot.overallState.nativeSemantic.systemImage)
                .font(.title2)
                .foregroundStyle(model.snapshot.overallState.nativeSemantic.tint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(ProductIdentity.current.displayName)
                    .font(.headline)
                HStack(spacing: 7) {
                    SemanticStatusPill(
                        semantic: model.snapshot.overallState.nativeSemantic,
                        text: model.snapshot.overallState.displayName
                    )
                    Text(model.distributionModeText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            if model.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(DesktopL10n.string("Refresh"))
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var runtimeSection: some View {
        MenuBarCard(
            title: DesktopL10n.string("Runtime Health"),
            systemImage: "waveform.path.ecg"
        ) {
            VStack(spacing: 7) {
                serviceRow(
                    DesktopL10n.string("Control Plane"),
                    state: model.snapshot.lifecycle.controlPlane
                )
                serviceRow(
                    DesktopL10n.string("Runner"),
                    state: model.snapshot.lifecycle.runner
                )
                serviceRow(
                    DesktopL10n.string("Process Supervisor"),
                    state: model.snapshot.lifecycle.processSupervisor
                )
            }
        }
    }

    private var activitySection: some View {
        let jobs = model.operationalSummary?.jobs
        let approvals = model.operationalSummary?.approvals

        return MenuBarCard(
            title: DesktopL10n.string("Activity"),
            systemImage: "waveform.path"
        ) {
            LazyVGrid(columns: metricColumns, alignment: .leading, spacing: 8) {
                metricTile(
                    DesktopL10n.string("Running jobs"),
                    count: jobs?.available == true ? jobs?.running : nil,
                    positiveSemantic: .active
                )
                metricTile(
                    DesktopL10n.string("Queued jobs"),
                    count: jobs?.available == true ? jobs?.queued : nil,
                    positiveSemantic: .pending
                )
                metricTile(
                    DesktopL10n.string("Failed records"),
                    count: jobs?.available == true ? jobs?.failed : nil,
                    positiveSemantic: .warning
                )
                metricTile(
                    DesktopL10n.string("Pending approvals"),
                    count: approvals?.available == true ? approvals?.pending : nil,
                    positiveSemantic: .pending
                )
            }
        }
    }

    private var accessSection: some View {
        MenuBarCard(
            title: DesktopL10n.string("Access"),
            systemImage: "lock.shield"
        ) {
            VStack(spacing: 8) {
                endpointRow(
                    title: DesktopL10n.string("Local Cockpit"),
                    url: model.snapshot.localCockpitURL,
                    fallback: DesktopL10n.string("Unavailable"),
                    openAction: model.openLocalCockpit
                )
                endpointRow(
                    title: DesktopL10n.string("Public Cockpit"),
                    url: model.snapshot.publicCockpitURL,
                    fallback: DesktopL10n.string("Not configured"),
                    openAction: model.openPublicCockpit
                )
            }
        }
    }

    @ViewBuilder
    private var attentionAndUpdateSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let conflict = model.runtimeConflict {
                attentionRow(
                    text: model.localizedConflictMessage(conflict),
                    semantic: .danger,
                    actionTitle: DesktopL10n.string("Runtime")
                ) {
                    openMainWindow(.runtime)
                }
            } else if let message = model.lastUserMessage {
                attentionRow(
                    text: message,
                    semantic: .warning,
                    actionTitle: DesktopL10n.string("Diagnostics")
                ) {
                    openMainWindow(.diagnostics)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: updateSemantic.systemImage)
                    .foregroundStyle(updateSemantic.tint)
                    .accessibilityHidden(true)
                Text(DesktopL10n.string("Update status"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(model.updateStatusText)
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.middle)
                AccessibleIconButton(
                    systemName: "chevron.right",
                    title: DesktopL10n.string("Updates"),
                    disabled: false,
                    destructive: false
                ) {
                    openMainWindow(.updates)
                }
                .frame(width: 22, height: 22)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                Color(nsColor: .controlBackgroundColor),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .accessibilityElement(children: .contain)
        }
    }

    private var lifecycleToolbar: some View {
        HStack(spacing: 8) {
            Text(DesktopL10n.string("Runtime controls"))
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer(minLength: 8)

            lifecycleActions

            AccessibleIconButton(
                systemName: "arrow.triangle.2.circlepath",
                title: DesktopL10n.string("Refresh"),
                disabled: model.isRefreshing,
                destructive: false
            ) {
                Task { await model.refresh() }
            }
            .frame(width: 24, height: 24)

            AccessibleIconButton(
                systemName: "safari",
                title: DesktopL10n.string("Open Local Cockpit"),
                disabled: model.snapshot.localCockpitURL == nil,
                destructive: false
            ) {
                model.openLocalCockpit()
            }
            .frame(width: 24, height: 24)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
    }

    @ViewBuilder
    private var lifecycleActions: some View {
        if model.runtimeConflict != nil {
            AccessibleIconButton(
                systemName: "exclamationmark.triangle",
                title: DesktopL10n.string("Runtime Conflict"),
                disabled: false,
                destructive: false
            ) {
                openMainWindow(.runtime)
            }
            .frame(width: 24, height: 24)
        } else {
            switch model.snapshot.overallState {
            case .setupRequired:
                AccessibleIconButton(
                    systemName: "wrench.and.screwdriver",
                    title: model.setupActionTitle,
                    disabled: model.isRefreshing,
                    destructive: false
                ) {
                    model.chooseSetupLocationFromPanel()
                }
                .frame(width: 24, height: 24)
            case .stopped:
                AccessibleIconButton(
                    systemName: "play.fill",
                    title: DesktopL10n.string("Start Services"),
                    disabled: model.isRefreshing,
                    destructive: false
                ) {
                    Task { await model.start() }
                }
                .frame(width: 24, height: 24)
            case .degraded, .ready:
                AccessibleIconButton(
                    systemName: "stop.fill",
                    title: DesktopL10n.string("Stop Services"),
                    disabled: model.isRefreshing,
                    destructive: true
                ) {
                    Task { await model.stop() }
                }
                .frame(width: 24, height: 24)

                AccessibleIconButton(
                    systemName: "arrow.clockwise",
                    title: DesktopL10n.string("Restart Services"),
                    disabled: model.isRefreshing,
                    destructive: false
                ) {
                    Task { await model.restart() }
                }
                .frame(width: 24, height: 24)
            }
        }
    }

    private var navigationSection: some View {
        VStack(spacing: 3) {
            AccessibleMenuBarNavigationButton(
                title: DesktopL10n.string("Open ChatCockpit"),
                systemName: "macwindow"
            ) {
                openMainWindow(.overview)
            }
            .frame(height: 28)

            AccessibleMenuBarNavigationButton(
                title: DesktopL10n.string("Diagnostics"),
                systemName: "stethoscope"
            ) {
                openMainWindow(.diagnostics)
            }
            .frame(height: 28)

            AccessibleMenuBarNavigationButton(
                title: DesktopL10n.string("Runtime Settings"),
                systemName: "gearshape"
            ) {
                openMainWindow(.runtime)
            }
            .frame(height: 28)

            AccessibleMenuBarNavigationButton(
                title: DesktopL10n.string("Quit ChatCockpit"),
                systemName: "power",
                destructive: true
            ) {
                NSApplication.shared.terminate(nil)
            }
            .frame(height: 28)
        }
        .padding(.top, 1)
    }

    private var updateSemantic: NativeStatusSemantic {
        switch model.updateCheckResult {
        case nil: return .unknown
        case .upToDate: return .healthy
        case .available: return .pending
        case .unableToCheck: return .warning
        }
    }

    private func openMainWindow(_ section: MainAppSection) {
        mainSection = section
        DesktopScenePresentation.present {
            openWindow(id: "main")
        }
    }

    private func serviceRow(_ title: String, state: RuntimeComponentState) -> some View {
        HStack(spacing: 8) {
            Image(systemName: state.nativeSemantic.systemImage)
                .foregroundStyle(state.nativeSemantic.tint)
                .accessibilityHidden(true)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(state.displayName)
                .font(.caption.weight(.medium))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(state.displayName)")
    }

    private func metricTile(
        _ title: String,
        count: Int?,
        positiveSemantic: NativeStatusSemantic
    ) -> some View {
        let semantic: NativeStatusSemantic = count.map { $0 > 0 ? positiveSemantic : .healthy } ?? .unknown
        let value = count.map(String.init) ?? "—"

        return HStack(spacing: 7) {
            Image(systemName: semantic.systemImage)
                .foregroundStyle(semantic.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(value)
                    .font(.callout.monospacedDigit().weight(.semibold))
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(
            Color(nsColor: .textBackgroundColor),
            in: RoundedRectangle(cornerRadius: 7, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(count.map(String.init) ?? DesktopL10n.string("Unavailable"))")
    }

    private func endpointRow(
        title: String,
        url: URL?,
        fallback: String,
        openAction: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let url {
                    Text(verbatim: url.absoluteString)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                } else {
                    Text(fallback)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            if let url {
                let copied = model.securityFeedback?.target == .apiEndpoint(url.absoluteString)
                    && model.securityFeedback?.kind == .copied

                AccessibleIconButton(
                    systemName: copied ? "checkmark" : "doc.on.doc",
                    title: copied
                        ? DesktopL10n.format("%@ address copied", title)
                        : DesktopL10n.format("Copy %@ address", title),
                    disabled: false,
                    destructive: false
                ) {
                    model.copyMachineEndpoint(url)
                }
                .id("menu-copy|\(title)|\(copied)")
                .frame(width: 22, height: 22)

                AccessibleIconButton(
                    systemName: "arrow.up.right.square",
                    title: DesktopL10n.format("Open %@ in Browser", title),
                    disabled: false,
                    destructive: false
                ) {
                    openAction()
                }
                .frame(width: 22, height: 22)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func attentionRow(
        text: String,
        semantic: NativeStatusSemantic,
        actionTitle: String,
        action: @escaping () -> Void
    ) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: semantic.systemImage)
                .foregroundStyle(semantic.tint)
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            AccessibleIconButton(
                systemName: "chevron.right",
                title: actionTitle,
                disabled: false,
                destructive: false,
                action: action
            )
            .frame(width: 22, height: 22)
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

private struct MenuBarCard<Content: View>: View {
    let title: String
    let systemImage: String
    let content: Content

    init(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            content
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
        }
    }
}

private struct AccessibleMenuBarNavigationButton: NSViewRepresentable {
    let title: String
    let systemName: String
    let destructive: Bool
    let action: () -> Void

    init(
        title: String,
        systemName: String,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemName = systemName
        self.destructive = destructive
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

    final class PointerButton: NSButton {
        override func resetCursorRects() {
            super.resetCursorRects()
            addCursorRect(bounds, cursor: isEnabled ? .pointingHand : .arrow)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> NSButton {
        let button = PointerButton()
        button.bezelStyle = .inline
        button.isBordered = false
        button.imagePosition = .imageLeading
        button.imageScaling = .scaleProportionallyDown
        button.alignment = .left
        button.focusRingType = .default
        button.refusesFirstResponder = false
        button.target = context.coordinator
        button.action = #selector(Coordinator.invoke)
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
        button.contentTintColor = destructive ? .systemRed : .labelColor
        button.image = NSImage(
            systemSymbolName: systemName,
            accessibilityDescription: title
        )?.withSymbolConfiguration(
            NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
        )
        button.setAccessibilityLabel(title)
        button.setAccessibilityHelp(title)
        button.setAccessibilityRole(.button)
    }
}
