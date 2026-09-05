import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop embedded renderer policy")
struct DesktopEmbeddedRendererPolicyTests {
    @Test("policy requires canonical IPv4 loopback origin")
    func policyOrigin() {
        #expect(DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "http://127.0.0.1:4318/ui/")!) != nil)
        #expect(DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "http://localhost:4318/ui/")!) == nil)
        #expect(DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "https://example.com/ui/")!) == nil)
    }

    @Test("same loopback origin stays embedded")
    func sameOrigin() {
        let policy = DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "http://127.0.0.1:4318/ui/")!)!
        #expect(policy.decision(for: URL(string: "http://127.0.0.1:4318/ui/projects")!, userInitiated: false) == .allow)
        #expect(policy.decision(for: URL(string: "http://127.0.0.1:4318/ui/runtime#details")!, userInitiated: true) == .allow)
        #expect(policy.decision(for: URL(string: "http://127.0.0.1:4319/ui/")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "http://localhost:4318/ui/")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "http://other.localhost:4318/ui/")!, userInitiated: true) == .reject)
        let alternateLoopback = ["127", "0", "0", "2"].joined(separator: ".")
        #expect(policy.decision(for: URL(string: "http://\(alternateLoopback):4318/ui/")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "http://0.0.0.0:4318/ui/")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "http://[::1]:4318/ui/")!, userInitiated: true) == .reject)
    }

    @Test("only user-initiated external HTTP navigation is handed off")
    func externalNavigation() {
        let policy = DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "http://127.0.0.1:4318/ui/")!)!
        #expect(policy.decision(for: URL(string: "https://example.com/docs")!, userInitiated: true) == .openExternally)
        #expect(policy.decision(for: URL(string: "https://example.com/redirect")!, userInitiated: false) == .reject)
        #expect(policy.decision(for: URL(string: "file:///tmp/secret")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "javascript:alert(1)")!, userInitiated: true) == .reject)
        #expect(policy.decision(for: URL(string: "data:text/plain,hello")!, userInitiated: true) == .reject)
    }

    @Test("only exact user-initiated Desktop Host handoffs leave the renderer")
    func desktopHostHandoffs() {
        let policy = DesktopEmbeddedNavigationPolicy(baseURL: URL(string: "http://127.0.0.1:4318/ui/")!)!
        for value in [
            "chatcockpit://operator/setup",
            "chatcockpit://settings/connectivity"
        ] {
            let url = URL(string: value)!
            #expect(policy.decision(for: url, userInitiated: true) == .openExternally)
            #expect(policy.decision(for: url, userInitiated: false) == .reject)
        }

        for value in [
            "chatcockpit://settings/connectivity?provider=cloudflare",
            "chatcockpit://settings/connectivity#install",
            "chatcockpit://settings/runtime",
            "chatcockpit://operator/setup?password=secret",
            "chatcockpit://unknown/path"
        ] {
            #expect(
                policy.decision(for: URL(string: value)!, userInitiated: true) == .reject
            )
        }
    }

    @Test("Desktop Host actions share one exact deep-link allowlist")
    func desktopHostActionDeepLinks() {
        #expect(DesktopHostAction(deepLinkURL: DesktopHostAction.operatorSetup.deepLinkURL) == .operatorSetup)
        #expect(DesktopHostAction(deepLinkURL: DesktopHostAction.connectivity.deepLinkURL) == .connectivity)

        for value in [
            "chatcockpit://operator/setup?password=secret",
            "chatcockpit://operator/setup#fragment",
            "chatcockpit://settings/connectivity?provider=cloudflare",
            "chatcockpit://settings/runtime",
            "chatcockpit://unknown/path"
        ] {
            #expect(DesktopHostAction(deepLinkURL: URL(string: value)!) == nil)
        }
    }

    @Test("Desktop Host bridge message body is strict and typed")
    func desktopHostBridgeRequestParsing() {
        #expect(
            DesktopHostBridgeRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "action": "operator.setup"
            ]) == DesktopHostBridgeRequest(action: .operatorSetup)
        )
        #expect(
            DesktopHostBridgeRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "action": "settings.connectivity"
            ]) == DesktopHostBridgeRequest(action: .connectivity)
        )
        #expect(
            DesktopHostBridgeRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: true),
                "action": "operator.setup"
            ]) == nil
        )
        #expect(
            DesktopHostBridgeRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "action": "runtime.restart"
            ]) == nil
        )
        #expect(
            DesktopHostBridgeRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "action": "operator.setup",
                "payload": ["command": "whoami"]
            ]) == nil
        )
    }

    @Test("Desktop Host bridge requires trusted main-frame gesture and exact origin")
    func desktopHostBridgePolicy() {
        let policy = DesktopHostBridgePolicy(
            baseURL: URL(string: "http://127.0.0.1:4318/ui/")!
        )!
        let source = DesktopHostBridgeSource(
            scheme: "http",
            host: "127.0.0.1",
            port: 4318,
            isMainFrame: true
        )

        for action in DesktopHostAction.allCases {
            #expect(
                policy.decision(
                    for: DesktopHostBridgeRequest(action: action),
                    source: source,
                    userGestureAttested: true
                ) == .allow(action)
            )
        }

        #expect(
            policy.decision(
                for: DesktopHostBridgeRequest(action: .operatorSetup),
                source: source,
                userGestureAttested: false
            ) == .reject(.userGestureRequired)
        )
        #expect(
            policy.decision(
                for: DesktopHostBridgeRequest(action: .operatorSetup),
                source: DesktopHostBridgeSource(
                    scheme: "http",
                    host: "127.0.0.1",
                    port: 4318,
                    isMainFrame: false
                ),
                userGestureAttested: true
            ) == .reject(.mainFrameRequired)
        )
        #expect(
            policy.decision(
                for: DesktopHostBridgeRequest(action: .operatorSetup),
                source: DesktopHostBridgeSource(
                    scheme: "http",
                    host: "127.0.0.1",
                    port: 4319,
                    isMainFrame: true
                ),
                userGestureAttested: true
            ) == .reject(.originMismatch)
        )
        #expect(
            policy.decision(
                for: DesktopHostBridgeRequest(schemaVersion: 2, action: .operatorSetup),
                source: source,
                userGestureAttested: true
            ) == .reject(.unsupportedSchemaVersion)
        )
    }

    @Test("Desktop Host picker request is strict, typed, and never a deep link")
    func desktopHostPickerRequestParsing() {
        #expect(
            DesktopHostPickerRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "capability": "project.root.pick"
            ]) == DesktopHostPickerRequest()
        )
        #expect(
            DesktopHostPickerRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: true),
                "capability": "project.root.pick"
            ]) == nil
        )
        #expect(
            DesktopHostPickerRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "capability": "operator.setup"
            ]) == nil
        )
        #expect(
            DesktopHostPickerRequest.parse(messageBody: [
                "schemaVersion": NSNumber(value: 1),
                "capability": "project.root.pick",
                "path": "/tmp/forged"
            ]) == nil
        )
        #expect(DesktopHostAction(rawValue: DesktopHostCapability.projectRootPick.rawValue) == nil)
        #expect(DesktopHostAction(deepLinkURL: URL(string: "chatcockpit://project/root/pick")!) == nil)

        #expect(
            DesktopHostPickerResult.selected(path: "/chosen/root").messageBody as NSDictionary
            == [
                "schemaVersion": 1,
                "capability": "project.root.pick",
                "status": "selected",
                "path": "/chosen/root"
            ] as NSDictionary
        )
        #expect(
            DesktopHostPickerResult.cancelled.messageBody as NSDictionary
            == [
                "schemaVersion": 1,
                "capability": "project.root.pick",
                "status": "cancelled"
            ] as NSDictionary
        )
    }

    @Test("Desktop Host picker requires trusted main-frame gesture, exact origin, and capability")
    func desktopHostPickerPolicy() {
        let source = DesktopHostBridgeSource(
            scheme: "http",
            host: "127.0.0.1",
            port: 4318,
            isMainFrame: true
        )
        let policy = DesktopHostBridgePolicy(
            baseURL: URL(string: "http://127.0.0.1:4318/ui/")!
        )!

        #expect(
            policy.pickerDecision(
                for: DesktopHostPickerRequest(),
                source: source,
                userGestureAttested: true
            ) == .allow(.projectRootPick)
        )
        #expect(
            policy.pickerDecision(
                for: DesktopHostPickerRequest(),
                source: source,
                userGestureAttested: false
            ) == .reject(.userGestureRequired)
        )

        let withoutPicker = DesktopHostBridgePolicy(
            baseURL: URL(string: "http://127.0.0.1:4318/ui/")!,
            supportedCapabilities: [.operatorSetup, .connectivity]
        )!
        #expect(
            withoutPicker.pickerDecision(
                for: DesktopHostPickerRequest(),
                source: source,
                userGestureAttested: true
            ) == .reject(.capabilityUnavailable)
        )
    }

    @Test("Desktop Host capability projection never exceeds the policy allowlist")
    func desktopHostCapabilityProjection() {
        let policy = DesktopHostBridgePolicy(
            baseURL: URL(string: "http://127.0.0.1:4318/ui/")!,
            supportedCapabilities: [.connectivity]
        )!

        #expect(policy.capabilityProjection.schemaVersion == 1)
        #expect(policy.capabilityProjection.capabilities == [.connectivity])
        #expect(
            policy.decision(
                for: DesktopHostBridgeRequest(action: .operatorSetup),
                source: DesktopHostBridgeSource(
                    scheme: "http",
                    host: "127.0.0.1",
                    port: 4318,
                    isMainFrame: true
                ),
                userGestureAttested: true
            ) == .reject(.capabilityUnavailable)
        )
    }
}
