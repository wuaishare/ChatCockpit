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
}
