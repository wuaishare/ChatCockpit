import Testing
@testable import TokenPilotDesktopCore

@Suite("Product identity")
struct ProductIdentityTests {
    @Test("legacy TokenPilot identity remains available for migration and compatibility inspection")
    func tokenPilotIdentity() {
        let identity = ProductIdentity.tokenPilot
        #expect(identity.displayName == "TokenPilot")
        #expect(identity.environmentPrefix == "TOKENPILOT")
        #expect(identity.stateDirectoryName == ".tokenpilot")
        #expect(identity.applicationSupportName == "TokenPilot")
        #expect(identity.bundleIdentifier == "cn.wuaishare.TokenPilot")
        #expect(identity.controlPlaneServiceLabel == "com.wuaishare.tokenpilot.control-plane")
        #expect(identity.runnerServiceLabel == "com.wuaishare.tokenpilot.runner")
        #expect(identity.processSupervisorServiceLabel == "com.wuaishare.tokenpilot.process-supervisor")
    }

    @Test("ChatCockpit identity is complete and internally consistent")
    func chatCockpitIdentity() {
        let identity = ProductIdentity.chatCockpit
        #expect(identity.displayName == "ChatCockpit")
        #expect(identity.environmentPrefix == "CHATCOCKPIT")
        #expect(identity.stateDirectoryName == ".chatcockpit")
        #expect(identity.applicationSupportName == "ChatCockpit")
        #expect(identity.bundleIdentifier == "cn.wuaishare.ChatCockpit")
        #expect(identity.controlPlaneServiceLabel == "com.wuaishare.chatcockpit.control-plane")
        #expect(identity.runnerServiceLabel == "com.wuaishare.chatcockpit.runner")
        #expect(identity.processSupervisorServiceLabel == "com.wuaishare.chatcockpit.process-supervisor")
        #expect(identity.environmentName("API_TOKEN") == "CHATCOCKPIT_API_TOKEN")
    }

    @Test("normal Swift builds use ChatCockpit as the canonical product identity")
    func defaultBuildIdentity() {
        #expect(ProductIdentity.current == .chatCockpit)
    }
}
