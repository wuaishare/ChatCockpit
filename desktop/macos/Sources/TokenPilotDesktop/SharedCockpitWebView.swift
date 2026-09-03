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

struct SharedCockpitView: View {
    @ObservedObject var model: DesktopAppModel
    let destination: DesktopCockpitDestination?
    let onOpenThisMac: () -> Void

    @State private var state: SharedCockpitState = .preparing
    @State private var attempt = 0

    private var preparationID: String {
        "\(attempt):\(destination?.rawValue ?? "overview")"
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
            }
        )
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
        await model.refresh()
        await model.refreshSecurity()

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

    final class Coordinator: NSObject, WKNavigationDelegate {
        let policy: DesktopEmbeddedNavigationPolicy
        var requestedURL: URL
        var onLoadingChanged: (Bool) -> Void
        var onLoadFailed: () -> Void

        init(
            policy: DesktopEmbeddedNavigationPolicy,
            requestedURL: URL,
            onLoadingChanged: @escaping (Bool) -> Void,
            onLoadFailed: @escaping () -> Void
        ) {
            self.policy = policy
            self.requestedURL = requestedURL
            self.onLoadingChanged = onLoadingChanged
            self.onLoadFailed = onLoadFailed
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
            requestedURL: requestedURL,
            onLoadingChanged: onLoadingChanged,
            onLoadFailed: onLoadFailed
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: requestedURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onLoadingChanged = onLoadingChanged
        context.coordinator.onLoadFailed = onLoadFailed

        guard context.coordinator.requestedURL != requestedURL else { return }
        context.coordinator.requestedURL = requestedURL
        if webView.url != requestedURL {
            webView.load(URLRequest(url: requestedURL))
        }
    }
}
