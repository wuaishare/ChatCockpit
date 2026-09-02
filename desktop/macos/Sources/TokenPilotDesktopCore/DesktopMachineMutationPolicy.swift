/// Desktop-side defense in depth for Machine mutations. Authoritative execution still
/// revalidates identity, policy, approval, revision, target and side-effect bounds server-side.
public enum DesktopMachineMutationPolicy {
    public static func requiresRuntimeRestart(for state: DesktopOverallState) -> Bool {
        state == .ready || state == .degraded
    }

    public static func acceptsConnectivityProviderPlan(
        _ plan: DesktopConnectivityProviderMutationPlan
    ) -> Bool {
        plan.requiresConfirmation &&
            plan.changesPublicRoute == false &&
            plan.startsTunnel == false &&
            plan.startsRuntime == false
    }

    public static func acceptsPublicRouteCutoverIntent(
        _ intent: DesktopPublicRouteCutoverIntent
    ) -> Bool {
        intent.requiresMachineAuthority &&
            intent.changesCanonicalOrigin &&
            intent.startsStoppedRuntime == false &&
            intent.startsProviderTunnel == false &&
            intent.writesProviderSecrets == false
    }

    public static func acceptsPublicRouteBootstrapProof(
        _ proof: DesktopPublicRouteBootstrapProof
    ) -> Bool {
        guard proof.status == "verified",
              let verification = proof.verification,
              verification.status == "verified" else {
            return false
        }

        return verification.checks.dns.ok &&
            verification.checks.tls.ok &&
            verification.checks.reachability.ok &&
            verification.checks.identity.ok
    }
}
