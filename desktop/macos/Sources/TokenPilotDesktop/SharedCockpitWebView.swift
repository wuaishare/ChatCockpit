import AppKit
import SwiftUI
import TokenPilotDesktopCore
import WebKit

private enum SharedCockpitState {
    case preparing
    case runtimeUnavailable
    case sessionUnavailable(URL)
    case web(URL, URL, isLoading: Bool)
    case loadFailed(URL)
}

private enum SharedCockpitDesktopHostBridge {
    static let handlerName = "chatcockpitDesktopHost"
    static let pickerHandlerName = "chatcockpitDesktopHostPicker"
    static let actionAttribute = "data-chatcockpit-desktop-host-action"
    static let pickerAttribute = "data-chatcockpit-desktop-host-picker"
    static let pickerResultEvent = "chatcockpit:desktop-host-picker-result"
    static let capabilityGlobal = "__chatcockpitDesktopHostCapabilities"
    static let contentWorld = WKContentWorld.world(name: "ChatCockpitDesktopHostBridge")

    static func capabilityProjectionScript(
        _ projection: DesktopHostCapabilityProjection
    ) -> String {
        guard let data = try? JSONEncoder().encode(projection),
              let json = String(data: data, encoding: .utf8) else {
            return ""
        }

        return """
        (() => {
          const raw = \(json);
          const projection = Object.freeze({
            schemaVersion: raw.schemaVersion,
            capabilities: Object.freeze(Array.from(raw.capabilities))
          });
          Object.defineProperty(window, "\(capabilityGlobal)", {
            value: projection,
            writable: false,
            configurable: false,
            enumerable: false
          });
        })();
        """
    }

    static func trustedGestureScript(
        _ projection: DesktopHostCapabilityProjection
    ) -> String {
        let capabilities = Set(projection.capabilities)
        let actions = DesktopHostAction.allCases
            .filter { capabilities.contains($0.capability) }
            .map(\.rawValue)
        guard let data = try? JSONEncoder().encode(actions),
              let json = String(data: data, encoding: .utf8) else {
            return ""
        }

        return """
        (() => {
          const allowedActions = new Set(\(json));
          document.addEventListener("click", (event) => {
            if (!(event instanceof MouseEvent) ||
                !event.isTrusted ||
                event.defaultPrevented ||
                event.button !== 0) {
              return;
            }
            if (navigator.userActivation && !navigator.userActivation.isActive) {
              return;
            }
            const element = event.target instanceof Element
              ? event.target.closest("[\(actionAttribute)]")
              : null;
            if (!element) {
              return;
            }
            const action = element.getAttribute("\(actionAttribute)");
            if (!action || !allowedActions.has(action)) {
              return;
            }
            event.preventDefault();
            window.webkit.messageHandlers.\(handlerName).postMessage({
              schemaVersion: \(DesktopHostBridgePolicy.schemaVersion),
              action
            });
          }, true);
        })();
        """
    }

    static func trustedPickerScript(
        _ projection: DesktopHostCapabilityProjection
    ) -> String {
        let pickerCapabilities = projection.capabilities
            .filter { $0 == .projectRootPick }
            .map(\.rawValue)
        guard let data = try? JSONEncoder().encode(pickerCapabilities),
              let json = String(data: data, encoding: .utf8) else {
            return ""
        }

        return """
        (() => {
          const allowedCapabilities = new Set(\(json));
          document.addEventListener("click", async (event) => {
            if (!(event instanceof MouseEvent) ||
                !event.isTrusted ||
                event.defaultPrevented ||
                event.button !== 0) {
              return;
            }
            if (navigator.userActivation && !navigator.userActivation.isActive) {
              return;
            }
            const element = event.target instanceof Element
              ? event.target.closest("[\(pickerAttribute)]")
              : null;
            if (!element) {
              return;
            }
            const capability = element.getAttribute("\(pickerAttribute)");
            if (!capability || !allowedCapabilities.has(capability)) {
              return;
            }

            event.preventDefault();
            let result;
            try {
              result = await window.webkit.messageHandlers.\(pickerHandlerName).postMessage({
                schemaVersion: \(DesktopHostBridgePolicy.schemaVersion),
                capability
              });
            } catch {
              return;
            }

            if (!result || typeof result !== "object" ||
                result.schemaVersion !== \(DesktopHostBridgePolicy.schemaVersion) ||
                result.capability !== capability ||
                (result.status !== "selected" && result.status !== "cancelled")) {
              return;
            }
            if (result.status === "selected" &&
                (typeof result.path !== "string" || result.path.length === 0)) {
              return;
            }
            if (result.status === "cancelled" && "path" in result) {
              return;
            }

            document.dispatchEvent(new CustomEvent("\(pickerResultEvent)", {
              detail: result.status === "selected"
                ? { capability, status: "selected", path: result.path }
                : { capability, status: "cancelled" }
            }));
          }, true);
        })();
        """
    }
}

struct SharedCockpitView: View {
    @ObservedObject var model: DesktopAppModel
    let destination: DesktopCockpitDestination?
    let onOpenThisMac: () -> Void
    let onDesktopHostAction: (DesktopHostAction) -> Void

    @State private var state: SharedCockpitState = .preparing
    @State private var attempt = 0

    private var preparationID: Int {
        attempt
    }

    var body: some View {
        Group {
            switch state {
            case .preparing:
                rendererStatus(
                    title: DesktopL10n.string("Preparing ChatCockpit…"),
                    systemImage: "hourglass"
                )
            case .runtimeUnavailable:
                rendererStatus(
                    title: DesktopL10n.string("Local Runtime is unavailable"),
                    detail: DesktopL10n.string(
                        "Start or repair the local Runtime from This Mac before opening ChatCockpit."
                    ),
                    systemImage: "bolt.slash",
                    retry: true,
                    showThisMac: true
                )
            case let .sessionUnavailable(baseURL):
                rendererStatus(
                    title: DesktopL10n.string("Embedded sign-in bootstrap failed"),
                    detail: DesktopL10n.string(
                        "ChatCockpit could not obtain a bounded local sign-in session. You can retry, inspect This Mac, or use the normal browser sign-in flow."
                    ),
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    retry: true,
                    showThisMac: true,
                    browserBaseURL: baseURL
                )
            case let .web(url, baseURL, isLoading):
                ZStack(alignment: .topTrailing) {
                    webView(url: url, baseURL: baseURL)
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .padding(10)
                    }
                }
            case let .loadFailed(baseURL):
                rendererStatus(
                    title: DesktopL10n.string("ChatCockpit failed to load"),
                    detail: DesktopL10n.string(
                        "The local Runtime is reachable, but the embedded Cockpit page failed to load."
                    ),
                    systemImage: "exclamationmark.triangle",
                    retry: true,
                    showThisMac: true,
                    browserBaseURL: baseURL
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: preparationID) {
            await prepare()
        }
        .onChange(of: destination?.rawValue) { _, _ in
            navigateWithinEmbeddedSession()
        }
    }

    @ViewBuilder
    private func rendererStatus(
        title: String,
        detail: String? = nil,
        systemImage: String,
        retry: Bool = false,
        showThisMac: Bool = false,
        browserBaseURL: URL? = nil
    ) -> some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 30))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            if let detail {
                Text(detail)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 560)
            }

            if retry || showThisMac || browserBaseURL != nil {
                HStack(spacing: 10) {
                    if retry {
                        Button(DesktopL10n.string("Retry")) {
                            attempt += 1
                        }
                    }
                    if showThisMac {
                        Button(DesktopL10n.string("This Mac")) {
                            onOpenThisMac()
                        }
                    }
                    if let browserBaseURL {
                        Button(DesktopL10n.string("Open in browser")) {
                            openInBrowser(baseURL: browserBaseURL)
                        }
                    }
                }
            }
        }
        .padding(32)
    }

    private func webView(url: URL, baseURL: URL) -> some View {
        SharedCockpitWebView(
            requestedURL: url,
            baseURL: baseURL,
            onLoadingChanged: { loading in
                state = .web(url, baseURL, isLoading: loading)
            },
            onLoadFailed: {
                state = .loadFailed(baseURL)
            },
            onDesktopHostAction: onDesktopHostAction
        )
    }

    private func navigateWithinEmbeddedSession() {
        guard case let .web(currentURL, baseURL, _) = state,
              let nextURL = DesktopCockpitSessionBuilder().directURL(
                  baseURL: baseURL,
                  destination: destination
              ),
              nextURL != currentURL else {
            return
        }
        state = .web(nextURL, baseURL, isLoading: true)
    }

    private func openInBrowser(baseURL: URL) {
        let safeURL = DesktopCockpitSessionBuilder().directURL(
            baseURL: baseURL,
            destination: destination
        ) ?? baseURL
        NSWorkspace.shared.open(safeURL)
    }

    @MainActor
    private func prepare() async {
        state = .preparing
        if model.snapshot.localCockpitURL == nil || model.operatorSecurityStatus == nil {
            async let runtimeRefresh: Void = model.refresh()
            async let securityRefresh: Void = model.refreshSecurity()
            _ = await (runtimeRefresh, securityRefresh)
        }

        let baseURL = model.snapshot.localCockpitURL
        switch await model.prepareEmbeddedCockpit(destination: destination) {
        case .runtimeUnavailable:
            state = .runtimeUnavailable
        case .sessionUnavailable:
            if let baseURL {
                state = .sessionUnavailable(baseURL)
            } else {
                state = .runtimeUnavailable
            }
        case let .ready(url, baseURL):
            state = .web(url, baseURL, isLoading: true)
        }
    }
}

private struct SharedCockpitWebView: NSViewRepresentable {
    let requestedURL: URL
    let baseURL: URL
    let onLoadingChanged: (Bool) -> Void
    let onLoadFailed: () -> Void
    let onDesktopHostAction: (DesktopHostAction) -> Void

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
        let policy: DesktopEmbeddedNavigationPolicy
        let hostBridgePolicy: DesktopHostBridgePolicy
        let baseURL: URL
        var requestedURL: URL
        var onLoadingChanged: (Bool) -> Void
        var onLoadFailed: () -> Void
        var onDesktopHostAction: (DesktopHostAction) -> Void

        init(
            policy: DesktopEmbeddedNavigationPolicy,
            hostBridgePolicy: DesktopHostBridgePolicy,
            baseURL: URL,
            requestedURL: URL,
            onLoadingChanged: @escaping (Bool) -> Void,
            onLoadFailed: @escaping () -> Void,
            onDesktopHostAction: @escaping (DesktopHostAction) -> Void
        ) {
            self.policy = policy
            self.hostBridgePolicy = hostBridgePolicy
            self.baseURL = baseURL
            self.requestedURL = requestedURL
            self.onLoadingChanged = onLoadingChanged
            self.onLoadFailed = onLoadFailed
            self.onDesktopHostAction = onDesktopHostAction
        }

        private func sameOrigin(_ left: URL, _ right: URL) -> Bool {
            left.scheme?.lowercased() == right.scheme?.lowercased()
                && left.host?.lowercased() == right.host?.lowercased()
                && left.port == right.port
        }

        private func routeTarget(for url: URL) -> String? {
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                return nil
            }
            var target = components.percentEncodedPath
            if let query = components.percentEncodedQuery, !query.isEmpty {
                target += "?\(query)"
            }
            if let fragment = components.percentEncodedFragment, !fragment.isEmpty {
                target += "#\(fragment)"
            }
            return target.isEmpty ? "/" : target
        }

        private func originString(for url: URL) -> String? {
            guard let scheme = url.scheme, let host = url.host else { return nil }
            if let port = url.port {
                return "\(scheme)://\(host):\(port)"
            }
            return "\(scheme)://\(host)"
        }

        private func canNavigateSameDocument(from currentURL: URL, to nextURL: URL) -> Bool {
            guard sameOrigin(currentURL, baseURL), sameOrigin(nextURL, baseURL) else {
                return false
            }
            let currentPath = currentURL.path.lowercased()
            return !currentPath.hasSuffix("/login") && !currentPath.hasSuffix("/local-login")
        }

        func navigate(_ webView: WKWebView, to nextURL: URL) {
            requestedURL = nextURL
            guard webView.url != nextURL else {
                onLoadingChanged(false)
                return
            }
            guard let currentURL = webView.url,
                  canNavigateSameDocument(from: currentURL, to: nextURL),
                  let target = routeTarget(for: nextURL),
                  let expectedOrigin = originString(for: baseURL) else {
                webView.load(URLRequest(url: nextURL))
                return
            }

            onLoadingChanged(true)
            webView.callAsyncJavaScript(
                """
                if (window.location.origin !== expectedOrigin) {
                    throw new Error("ChatCockpit embedded origin changed");
                }
                const current = window.location.pathname + window.location.search + window.location.hash;
                if (current !== target) {
                    window.history.pushState(null, "", target);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                }
                return window.location.pathname + window.location.search + window.location.hash;
                """,
                arguments: [
                    "expectedOrigin": expectedOrigin,
                    "target": target
                ],
                in: nil,
                in: .page
            ) { [weak webView, weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    switch result {
                    case .success:
                        self.onLoadingChanged(false)
                    case .failure:
                        webView?.load(URLRequest(url: nextURL))
                    }
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            let userInitiated = navigationAction.navigationType == .linkActivated
            switch policy.decision(for: url, userInitiated: userInitiated) {
            case .allow:
                if navigationAction.targetFrame == nil {
                    webView.load(navigationAction.request)
                    decisionHandler(.cancel)
                } else {
                    decisionHandler(.allow)
                }
            case .openExternally:
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            case .reject:
                decisionHandler(.cancel)
            }
        }

        private func hostBridgeSource(
            for message: WKScriptMessage
        ) -> DesktopHostBridgeSource? {
            guard let url = message.frameInfo.request.url,
                  let scheme = url.scheme?.lowercased(),
                  let host = url.host?.lowercased() else {
                return nil
            }
            let port = url.port ?? (scheme == "https" ? 443 : 80)
            return DesktopHostBridgeSource(
                scheme: scheme,
                host: host,
                port: port,
                isMainFrame: message.frameInfo.isMainFrame
            )
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == SharedCockpitDesktopHostBridge.handlerName,
                  let request = DesktopHostBridgeRequest.parse(messageBody: message.body),
                  let source = hostBridgeSource(for: message) else {
                return
            }

            switch hostBridgePolicy.decision(
                for: request,
                source: source,
                userGestureAttested: true
            ) {
            case let .allow(action):
                DispatchQueue.main.async { [weak self] in
                    self?.onDesktopHostAction(action)
                }
            case .reject:
                return
            }
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
        ) {
            guard message.name == SharedCockpitDesktopHostBridge.pickerHandlerName,
                  let request = DesktopHostPickerRequest.parse(messageBody: message.body),
                  let source = hostBridgeSource(for: message) else {
                Task { @MainActor in
                    replyHandler(nil, "invalid-request")
                }
                return
            }

            let decision = hostBridgePolicy.pickerDecision(
                for: request,
                source: source,
                userGestureAttested: true
            )
            Task { @MainActor in
                switch decision {
                case .allow(.projectRootPick):
                    let panel = NSOpenPanel()
                    panel.title = DesktopL10n.string("Choose Project Folder")
                    panel.message = DesktopL10n.string(
                        "Choose one folder for the Project workflow. ChatCockpit only returns the folder you explicitly select."
                    )
                    panel.prompt = DesktopL10n.string("Choose")
                    panel.canChooseFiles = false
                    panel.canChooseDirectories = true
                    panel.allowsMultipleSelection = false
                    panel.canCreateDirectories = false

                    let result: DesktopHostPickerResult
                    if panel.runModal() == .OK, let url = panel.url {
                        result = .selected(path: url.standardizedFileURL.path)
                    } else {
                        result = .cancelled
                    }
                    replyHandler(result.messageBody, nil)
                case .allow:
                    replyHandler(nil, "unsupported-capability")
                case .reject:
                    replyHandler(nil, "rejected")
                }
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            onLoadingChanged(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onLoadingChanged(false)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onLoadFailed()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onLoadFailed()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            policy: DesktopEmbeddedNavigationPolicy(baseURL: baseURL)!,
            hostBridgePolicy: DesktopHostBridgePolicy(baseURL: baseURL)!,
            baseURL: baseURL,
            requestedURL: requestedURL,
            onLoadingChanged: onLoadingChanged,
            onLoadFailed: onLoadFailed,
            onDesktopHostAction: onDesktopHostAction
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let projection = context.coordinator.hostBridgePolicy.capabilityProjection
        let userContentController = configuration.userContentController
        userContentController.add(
            context.coordinator,
            contentWorld: SharedCockpitDesktopHostBridge.contentWorld,
            name: SharedCockpitDesktopHostBridge.handlerName
        )
        userContentController.addScriptMessageHandler(
            context.coordinator,
            contentWorld: SharedCockpitDesktopHostBridge.contentWorld,
            name: SharedCockpitDesktopHostBridge.pickerHandlerName
        )
        userContentController.addUserScript(
            WKUserScript(
                source: SharedCockpitDesktopHostBridge.capabilityProjectionScript(projection),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: .page
            )
        )
        userContentController.addUserScript(
            WKUserScript(
                source: SharedCockpitDesktopHostBridge.trustedGestureScript(projection),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: SharedCockpitDesktopHostBridge.contentWorld
            )
        )
        userContentController.addUserScript(
            WKUserScript(
                source: SharedCockpitDesktopHostBridge.trustedPickerScript(projection),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: SharedCockpitDesktopHostBridge.contentWorld
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: requestedURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onLoadingChanged = onLoadingChanged
        context.coordinator.onLoadFailed = onLoadFailed
        context.coordinator.onDesktopHostAction = onDesktopHostAction

        guard context.coordinator.requestedURL != requestedURL else { return }
        context.coordinator.navigate(webView, to: requestedURL)
    }
}
