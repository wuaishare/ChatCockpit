import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop Cockpit session foundation")
struct DesktopCockpitSessionTests {
    private let builder = DesktopCockpitSessionBuilder()
    private let baseURL = URL(string: "http://127.0.0.1:4318/ui/?old=1#old")!

    @Test("shared destination allowlist maps to canonical paths")
    func sharedDestinationMapping() {
        let expected: [(DesktopCockpitDestination, String)] = [
            (.projects, "/ui/projects"),
            (.work, "/ui/continuity/tasks"),
            (.runtime, "/ui/runtime"),
            (.resources, "/ui/resources"),
            (.devices, "/ui/devices"),
            (.publicAccess, "/ui/public-access"),
            (.integrations, "/ui/integrations")
        ]

        #expect(DesktopCockpitDestination.allCases.count == expected.count)
        for (destination, path) in expected {
            #expect(destination.targetPath == path)
            #expect(builder.directURL(baseURL: baseURL, destination: destination)?.path == path)
        }
    }

    @Test("direct URLs remove stale query and fragment")
    func directURLIsCanonical() throws {
        let url = try #require(builder.directURL(baseURL: baseURL, destination: .runtime))
        #expect(url.absoluteString == "http://127.0.0.1:4318/ui/runtime")
        #expect(url.query == nil)
        #expect(url.fragment == nil)
    }

    @Test("local login URL carries only fixed target and one-time grant")
    func localLoginURL() throws {
        let url = try #require(builder.localLoginURL(
            baseURL: baseURL,
            destination: .resources,
            grantSecret: "cc_local_login_test_grant"
        ))
        #expect(url.path == "/ui/local-login")
        #expect(url.query == "target=resources")
        #expect(url.fragment == "local-login=cc_local_login_test_grant")
    }

    @Test("root Cockpit bootstrap omits continuation target")
    func rootBootstrapHasNoTarget() throws {
        let url = try #require(builder.localLoginURL(
            baseURL: baseURL,
            grantSecret: "cc_local_login_test_grant"
        ))
        #expect(url.path == "/ui/local-login")
        #expect(url.query == nil)
        #expect(url.fragment == "local-login=cc_local_login_test_grant")
    }

    @Test("unknown continuation keys cannot enter the desktop mapping")
    func destinationAllowlistRejectsUnknownKeys() {
        #expect(DesktopCockpitDestination(rawValue: "settings") == nil)
        #expect(DesktopCockpitDestination(rawValue: "../../machine-token") == nil)
    }

    @Test("base fallback keeps the Cockpit root but strips transient state")
    func baseFallbackIsCanonical() throws {
        let url = try #require(builder.directURL(baseURL: baseURL))
        #expect(url.absoluteString == "http://127.0.0.1:4318/ui/")
        #expect(url.query == nil)
        #expect(url.fragment == nil)
    }
}
