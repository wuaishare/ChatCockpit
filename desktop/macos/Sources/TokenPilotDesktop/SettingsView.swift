import AppKit
import SwiftUI
import TokenPilotDesktopCore

struct SettingsView: View {
    @ObservedObject var model: DesktopAppModel
    @State private var consolePathPrefix = "/ui"
    @State private var trustedLanEnabled = false
    @State private var trustedLanCidrsText = ""

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
                Section(DesktopL10n.string("Workspaces")) {
                    if model.packagedWorkspaces.isEmpty {
                        LabeledContent(DesktopL10n.string("Primary Workspace")) {
                            Text(DesktopL10n.string("Not selected"))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.packagedWorkspaces) { workspace in
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 8) {
                                    Text(verbatim: workspace.repoID)
                                        .font(.system(.body, design: .monospaced))
                                    if workspace.isPrimary {
                                        Text(DesktopL10n.string("Primary"))
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary, in: Capsule())
                                    }
                                    if !workspace.isAvailable {
                                        Label(DesktopL10n.string("Unavailable"), systemImage: "exclamationmark.triangle")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }

                                Text((workspace.url.path as NSString).abbreviatingWithTildeInPath)
                                    .font(.caption)
                                    .foregroundStyle(workspace.isAvailable ? .secondary : .tertiary)
                                    .textSelection(.enabled)
                                    .lineLimit(2)

                                if !workspace.isPrimary {
                                    HStack(spacing: 8) {
                                        Button(DesktopL10n.string("Make Primary")) {
                                            Task { await model.makeWorkspacePrimary(workspace.repoID) }
                                        }
                                        .disabled(!workspace.isAvailable || model.isRefreshing)

                                        Button(DesktopL10n.string("Remove"), role: .destructive) {
                                            model.confirmAndRemoveWorkspace(workspace)
                                        }
                                        .disabled(model.isRefreshing)
                                    }
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    HStack {
                        Button(
                            model.packagedWorkspaces.isEmpty
                                ? DesktopL10n.string("Choose Primary Workspace…")
                                : DesktopL10n.string("Add Workspace…")
                        ) {
                            if model.packagedWorkspaces.isEmpty {
                                model.chooseWorkspaceFromPanel()
                            } else {
                                model.addWorkspaceFromPanel()
                            }
                        }
                        Button(DesktopL10n.string("Refresh Workspaces")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.isRefreshing)
                    }

                    Text(
                        DesktopL10n.string(
                            "The primary workspace is the default project used to bootstrap Packaged Mode. Additional authorized workspaces keep stable repository IDs. Adding, removing, or changing the primary workspace never starts, stops, or restarts the Runtime automatically."
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
                    Text(verbatim: model.endpointText)
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

                HStack {
                    Button(DesktopL10n.string("Open Local Cockpit")) {
                        model.openLocalCockpit()
                    }
                    .disabled(model.snapshot.localCockpitURL == nil)

                    if model.snapshot.publicCockpitURL != nil {
                        Button(DesktopL10n.string("Open Public Cockpit")) {
                            model.openPublicCockpit()
                        }
                    }
                }
            }

            Section(DesktopL10n.string("Security & Access")) {
                LabeledContent(DesktopL10n.string("Runtime mode")) {
                    Text(
                        model.snapshot.configuration.exposed
                            ? DesktopL10n.string("Exposed")
                            : DesktopL10n.string("Local only")
                    )
                }

                LabeledContent(DesktopL10n.string("Web Owner")) {
                    if let status = model.operatorSecurityStatus {
                        Text(
                            status.configured
                                ? (status.username ?? DesktopL10n.string("Configured"))
                                : DesktopL10n.string("Not configured")
                        )
                    } else {
                        Text(DesktopL10n.string("Unavailable"))
                            .foregroundStyle(.secondary)
                    }
                }

                if let status = model.operatorSecurityStatus, status.configured {
                    LabeledContent(DesktopL10n.string("Active Web sessions")) {
                        Text(verbatim: String(status.activeSessionCount))
                    }
                }

                HStack {
                    Button(
                        DesktopL10n.string(
                            model.operatorSecurityStatus?.configured == true
                                ? "Manage Owner…"
                                : "Set Owner…"
                        )
                    ) {
                        model.setOwnerPasswordFromPanel()
                    }

                    Button(DesktopL10n.string("Revoke Web Sessions"), role: .destructive) {
                        Task { await model.revokeOwnerSessions() }
                    }
                    .disabled(model.operatorSecurityStatus?.configured != true)
                }

                if let feedback = model.securityFeedback,
                   feedback.target == .ownerAccount,
                   feedback.kind == .updated {
                    transientFeedbackLabel(feedback.message)
                }

                Divider()

                machineApiTokenRow

                if let localApiBaseURL = model.snapshot.localApiBaseURL {
                    apiAddressRow(DesktopL10n.string("Local API base"), url: localApiBaseURL)
                }
                if let localMcpURL = model.snapshot.localMcpURL {
                    apiAddressRow(DesktopL10n.string("Local MCP endpoint"), url: localMcpURL)
                }
                if let publicApiBaseURL = model.snapshot.publicApiBaseURL {
                    apiAddressRow(DesktopL10n.string("Public API base"), url: publicApiBaseURL)
                }
                if let publicMcpURL = model.snapshot.publicMcpURL {
                    apiAddressRow(DesktopL10n.string("Public MCP endpoint"), url: publicMcpURL)
                }

                if let feedback = model.securityFeedback,
                   feedback.target == .machineApiToken,
                   feedback.kind == .updated {
                    transientFeedbackLabel(feedback.message)
                }

                Text(
                    DesktopL10n.string(
                        "Web Owner sessions, machine API credentials, and ChatGPT OAuth are separate authorities. Token reveal is temporary and stays in memory only. Rotating the machine token restarts services only when they are already running; stopped services stay stopped. Web Owner and ChatGPT OAuth sessions are not revoked."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(
                    DesktopL10n.string(
                        "Opening Local Cockpit from this App uses a single-use loopback login grant when the console administrator is configured. The grant expires quickly, is never persisted in browser storage, and does not weaken public authentication."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section(DesktopL10n.string("Access Policy")) {
                LabeledContent(DesktopL10n.string("Console path")) {
                    TextField("/ui", text: $consolePathPrefix)
                        .font(.system(.body, design: .monospaced))
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 300)
                }

                Toggle(DesktopL10n.string("Enable trusted LAN access"), isOn: $trustedLanEnabled)

                LabeledContent(DesktopL10n.string("Allowed LAN CIDRs")) {
                    TextEditor(text: $trustedLanCidrsText)
                        .font(.system(.caption, design: .monospaced))
                        .frame(width: 300, height: 58)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.quaternary)
                        )
                }

                if trustedLanEnabled,
                   model.snapshot.configuration.host == "127.0.0.1" || model.snapshot.configuration.host == "::1" {
                    Label(
                        DesktopL10n.string(
                            "Trusted LAN policy is enabled, but the runtime is still listening on loopback only. LAN devices cannot connect until the listener is explicitly bound to a LAN-capable address."
                        ),
                        systemImage: "info.circle"
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(
                    DesktopL10n.string(
                        "A custom console path only reduces opportunistic scanning; it never replaces authentication. Trusted LAN CIDRs are a network admission gate only. Allowed LAN devices must still sign in with a Passkey or password fallback, and public access remains HTTPS + authentication."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack {
                    Button(DesktopL10n.string("Apply Access Policy")) {
                        let cidrs = trustedLanCidrsText
                            .split(whereSeparator: { $0.isNewline || $0 == "," })
                            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                            .filter { !$0.isEmpty }
                        Task {
                            await model.applyAccessPolicy(
                                consolePathPrefix: consolePathPrefix,
                                trustedLanEnabled: trustedLanEnabled,
                                trustedLanCidrs: cidrs
                            )
                        }
                    }
                    .disabled(trustedLanEnabled && trustedLanCidrsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .help(DesktopL10n.string("Apply Access Policy"))
                    .accessibilityLabel(DesktopL10n.string("Apply Access Policy"))

                    if let feedback = model.securityFeedback,
                       feedback.target == .accessPolicy,
                       feedback.kind == .updated {
                        transientFeedbackLabel(feedback.message)
                    }
                }
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
        .task {
            await model.refreshSecurity()
            syncAccessPolicyFields()
        }
    }

    private func syncAccessPolicyFields() {
        guard let policy = model.accessPolicyStatus else { return }
        consolePathPrefix = policy.consolePathPrefix
        trustedLanEnabled = policy.trustedLan.enabled
        trustedLanCidrsText = policy.trustedLan.cidrs.joined(separator: "\n")
    }

    @ViewBuilder
    private var machineApiTokenRow: some View {
        securityActionRow(DesktopL10n.string("Machine API token")) {
            HStack(spacing: 6) {
                Group {
                    if let token = model.revealedMachineApiToken {
                        Text(verbatim: token)
                    } else if let status = model.machineApiTokenStatus, status.configured {
                        Text(verbatim: status.fingerprint ?? DesktopL10n.string("Configured"))
                    } else {
                        Text(DesktopL10n.string("Not configured"))
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(.body, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)

                let tokenConfigured = model.machineApiTokenStatus?.configured == true
                let tokenRevealed = model.revealedMachineApiToken != nil
                let tokenCopied = model.securityFeedback?.target == .machineApiToken
                    && model.securityFeedback?.kind == .copied

                iconActionButton(
                    systemName: tokenRevealed ? "eye.slash" : "eye",
                    title: DesktopL10n.string(tokenRevealed ? "Hide Token" : "Reveal Token"),
                    disabled: !tokenConfigured
                ) {
                    if tokenRevealed {
                        model.hideMachineApiToken()
                    } else {
                        Task { await model.revealMachineApiToken() }
                    }
                }

                iconActionButton(
                    systemName: tokenCopied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(tokenCopied ? "Copied" : "Copy Token"),
                    disabled: !tokenConfigured
                ) {
                    Task { await model.copyMachineApiToken() }
                }

                iconActionButton(
                    systemName: "arrow.triangle.2.circlepath",
                    title: DesktopL10n.string("Rotate Token…"),
                    role: .destructive
                ) {
                    Task { await model.rotateMachineApiToken() }
                }
            }
        }
    }

    @ViewBuilder
    private func apiAddressRow(_ title: String, url: URL) -> some View {
        let copied = model.securityFeedback?.target == .apiEndpoint(url.absoluteString)
            && model.securityFeedback?.kind == .copied

        securityActionRow(title) {
            HStack(spacing: 6) {
                Text(verbatim: url.absoluteString)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)

                iconActionButton(
                    systemName: copied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(copied ? "Copied" : "Copy API address")
                ) {
                    model.copyMachineEndpoint(url)
                }
            }
        }
    }

    private func securityActionRow<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .frame(width: 150, alignment: .leading)
            Spacer(minLength: 8)
            content()
        }
    }

    private func transientFeedbackLabel(_ message: String) -> some View {
        Label(message, systemImage: "checkmark.circle")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
            .accessibilityLabel(message)
    }

    private func iconActionButton(
        systemName: String,
        title: String,
        role: ButtonRole? = nil,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        AccessibleIconButton(
            systemName: systemName,
            title: title,
            disabled: disabled,
            destructive: role == .destructive,
            action: action
        )
        .frame(width: 20, height: 20)
    }
}

private struct AccessibleIconButton: NSViewRepresentable {
    let systemName: String
    let title: String
    let disabled: Bool
    let destructive: Bool
    let action: () -> Void

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
        button.isBordered = false
        button.imagePosition = .imageOnly
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
        let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
        button.image = NSImage(systemSymbolName: systemName, accessibilityDescription: title)?
            .withSymbolConfiguration(configuration)
        button.title = ""
        button.toolTip = title
        button.isEnabled = !disabled
        button.contentTintColor = destructive ? .systemRed : .labelColor
        button.setAccessibilityLabel(title)
        button.setAccessibilityHelp(title)
        button.setAccessibilityRole(.button)
        button.window?.invalidateCursorRects(for: button)
    }
}
