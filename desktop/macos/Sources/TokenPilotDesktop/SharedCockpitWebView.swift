import AppKit
import SwiftUI
import TokenPilotDesktopCore
import WebKit

private enum SharedCockpitPrototypeState {
    case preparing
    case runtimeUnavailable
    case sessionUnavailable
    case web(URL, URL, isLoading: Bool)
    case loadFailed(URL)
}

struct SharedCockpitPrototypeView: View {
    @ObservedObject var model: DesktopAppModel
    @State private var state: SharedCockpitPrototypeState = .preparing
    @State private var attempt = 0

    var body: some View {
        Group {
            switch state {
            case .preparing:
                prototypeStatus(
                    title: DesktopL10n.string("Preparing shared renderer…"),
                    systemImage: "hourglass"
                )
            case .runtimeUnavailable:
                prototypeStatus(
                    title: DesktopL10n.string("Local Runtime is unavailable"),
                    detail: DesktopL10n.string("Start or repair the local Runtime before opening the shared renderer prototype."),
                    systemImage: "bolt.slash",
                    retry: true
                )
            case .sessionUnavailable:
                prototypeStatus(
                    title: DesktopL10n.string("Embedded session bootstrap failed"),
                    detail: DesktopL10n.string("The prototype could not obtain a bounded local sign-in session. Native ChatCockpit remains available."),
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    retry: true
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
                prototypeStatus(
                    title: DesktopL10n.string("Shared renderer failed to load"),
                    detail: DesktopL10n.string("The local Runtime is reachable, but the embedded page failed to load."),
                    systemImage: "exclamationmark.triangle",
                    retry: true
                )
                .overlay(alignment: .bottomTrailing) {
                    Button(DesktopL10n.string("Open in browser")) {
                        let safeURL = DesktopCockpitSessionBuilder().directURL(
                            baseURL: baseURL,
                            destination: .projects
                        ) ?? baseURL
                        NSWorkspace.shared.open(safeURL)
                    }
                    .padding()
                    .help(baseURL.absoluteString)
                }
            }
        }
        .frame(minWidth: 760, minHeight: 520)
        .task(id: attempt) {
            await prepare()
        }
    }

    @ViewBuilder
    private func prototypeStatus(
        title: String,
        detail: String? = nil,
        systemImage: String,
        retry: Bool = false
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
                    .frame(maxWidth: 520)
            }
            if retry {
                Button(DesktopL10n.string("Retry")) {
                    attempt += 1
                }
            }
        }
        .padding(32)
    }

    private func webView(url: URL, baseURL: URL) -> some View {
        SharedCockpitWebView(
            initialURL: url,
            baseURL: baseURL,
            onLoadingChanged: { loading in
                let stateURL = loading
                    ? url
                    : (DesktopCockpitSessionBuilder().directURL(
                        baseURL: baseURL,
                        destination: .projects
                    ) ?? baseURL)
                state = .web(stateURL, baseURL, isLoading: loading)
            },
            onLoadFailed: {
                state = .loadFailed(baseURL)
            }
        )
    }

    @MainActor
    private func prepare() async {
        state = .preparing
        await model.refresh()
        await model.refreshSecurity()
        switch await model.prepareEmbeddedCockpit(destination: .projects) {
        case .runtimeUnavailable:
            state = .runtimeUnavailable
        case .sessionUnavailable:
            state = .sessionUnavailable
        case let .ready(url, baseURL):
            state = .web(url, baseURL, isLoading: true)
        }
    }
}

private struct SharedCockpitWebView: NSViewRepresentable {
    let initialURL: URL
    let baseURL: URL
    let onLoadingChanged: (Bool) -> Void
    let onLoadFailed: () -> Void

    final class Coordinator: NSObject, WKNavigationDelegate {
        let policy: DesktopEmbeddedNavigationPolicy
        var onLoadingChanged: (Bool) -> Void
        var onLoadFailed: () -> Void

        init(
            policy: DesktopEmbeddedNavigationPolicy,
            onLoadingChanged: @escaping (Bool) -> Void,
            onLoadFailed: @escaping () -> Void
        ) {
            self.policy = policy
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
        webView.load(URLRequest(url: initialURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onLoadingChanged = onLoadingChanged
        context.coordinator.onLoadFailed = onLoadFailed
    }
}
