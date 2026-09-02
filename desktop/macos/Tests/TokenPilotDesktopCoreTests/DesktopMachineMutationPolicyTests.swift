import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop machine mutation policy")
struct DesktopMachineMutationPolicyTests {
    @Test("runtime restart requirement follows running-state truth")
    func runtimeRestartRequirement() {
        #expect(DesktopMachineMutationPolicy.requiresRuntimeRestart(for: .ready))
        #expect(DesktopMachineMutationPolicy.requiresRuntimeRestart(for: .degraded))
        #expect(!DesktopMachineMutationPolicy.requiresRuntimeRestart(for: .stopped))
        #expect(!DesktopMachineMutationPolicy.requiresRuntimeRestart(for: .setupRequired))
    }

    @Test("provider plans reject side effects outside package management")
    func providerPlanSafety() throws {
        #expect(DesktopMachineMutationPolicy.acceptsConnectivityProviderPlan(
            try providerPlan()
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsConnectivityProviderPlan(
            try providerPlan(requiresConfirmation: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsConnectivityProviderPlan(
            try providerPlan(changesPublicRoute: true)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsConnectivityProviderPlan(
            try providerPlan(startsTunnel: true)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsConnectivityProviderPlan(
            try providerPlan(startsRuntime: true)
        ))
    }

    @Test("cutover intent requires the bounded machine contract")
    func cutoverIntentSafety() throws {
        #expect(DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent()
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent(requiresMachineAuthority: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent(changesCanonicalOrigin: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent(startsStoppedRuntime: true)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent(startsProviderTunnel: true)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteCutoverIntent(
            try cutoverIntent(writesProviderSecrets: true)
        ))
    }

    @Test("bootstrap proof requires every verified check")
    func bootstrapProofSafety() throws {
        #expect(DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof()
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(proofStatus: "prepared")
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(verificationStatus: "failed")
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(dnsOK: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(tlsOK: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(reachabilityOK: false)
        ))
        #expect(!DesktopMachineMutationPolicy.acceptsPublicRouteBootstrapProof(
            try bootstrapProof(identityOK: false)
        ))
    }

    private func providerPlan(
        requiresConfirmation: Bool = true,
        changesPublicRoute: Bool = false,
        startsTunnel: Bool = false,
        startsRuntime: Bool = false
    ) throws -> DesktopConnectivityProviderMutationPlan {
        try decode("""
        {
          "schemaVersion": 1,
          "planId": "plan-1",
          "providerId": "cloudflare-tunnel",
          "displayName": "Cloudflare Tunnel",
          "packageManager": "homebrew",
          "action": "install",
          "requiresConfirmation": \(requiresConfirmation),
          "changesPublicRoute": \(changesPublicRoute),
          "startsTunnel": \(startsTunnel),
          "startsRuntime": \(startsRuntime),
          "expectedDetection": "not-detected",
          "expectedVersion": null,
          "expectedManagedByChatCockpit": false,
          "preparedAt": "2026-09-03T00:00:00Z",
          "expiresAt": "2026-09-03T00:05:00Z"
        }
        """)
    }

    private func cutoverIntent(
        requiresMachineAuthority: Bool = true,
        changesCanonicalOrigin: Bool = true,
        startsStoppedRuntime: Bool = false,
        startsProviderTunnel: Bool = false,
        writesProviderSecrets: Bool = false
    ) throws -> DesktopPublicRouteCutoverIntent {
        try decode("""
        {
          "id": "intent-1",
          "kind": "cutover",
          "status": "prepared",
          "candidateId": "candidate-1",
          "candidateOrigin": "https://chatcockpit.example.com",
          "verificationId": "verification-1",
          "expectedCanonicalOrigin": "https://old.example.com",
          "requiresMachineAuthority": \(requiresMachineAuthority),
          "changesCanonicalOrigin": \(changesCanonicalOrigin),
          "mayRestartRunningRuntime": true,
          "startsStoppedRuntime": \(startsStoppedRuntime),
          "startsProviderTunnel": \(startsProviderTunnel),
          "writesProviderSecrets": \(writesProviderSecrets),
          "preparedAt": "2026-09-03T00:00:00Z",
          "expiresAt": "2026-09-03T00:05:00Z"
        }
        """)
    }

    private func bootstrapProof(
        proofStatus: String = "verified",
        verificationStatus: String = "verified",
        dnsOK: Bool = true,
        tlsOK: Bool = true,
        reachabilityOK: Bool = true,
        identityOK: Bool = true
    ) throws -> DesktopPublicRouteBootstrapProof {
        try decode("""
        {
          "id": "proof-1",
          "candidateId": "candidate-1",
          "candidateOrigin": "https://chatcockpit.example.com",
          "status": "\(proofStatus)",
          "preparedAt": "2026-09-03T00:00:00Z",
          "expiresAt": "2026-09-03T00:05:00Z",
          "verifiedAt": "2026-09-03T00:01:00Z",
          "verification": {
            "id": "verification-1",
            "status": "\(verificationStatus)",
            "checkedAt": "2026-09-03T00:01:00Z",
            "checks": {
              "dns": {"ok": \(dnsOK), "reason": null, "statusCode": null, "publicAddressCount": 1},
              "tls": {"ok": \(tlsOK), "reason": null, "statusCode": 200, "publicAddressCount": null},
              "reachability": {"ok": \(reachabilityOK), "reason": null, "statusCode": 200, "publicAddressCount": null},
              "identity": {"ok": \(identityOK), "reason": null, "statusCode": 200, "publicAddressCount": null}
            }
          }
        }
        """)
    }

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
