import { networkInterfaces } from "node:os";

import {
  isTrustedLanAddress,
  type AccessPolicy
} from "../security/access-policy.js";

export type LanAccessStatus =
  | "disabled"
  | "listener-loopback"
  | "no-trusted-address"
  | "ready";

export interface LanAccessSnapshot {
  enabled: boolean;
  status: LanAccessStatus;
  trustedCidrs: string[];
  cockpitUrls: string[];
  apiBaseUrls: string[];
}

export interface LanAccessSnapshotInput {
  policy: AccessPolicy;
  host: string;
  port: number;
  consolePathPrefix: string;
  addresses?: readonly string[];
}

function systemLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const address = entry.address.trim();
      if (!address || address.includes("%")) continue;
      addresses.push(address);
    }
  }
  return [...new Set(addresses)].sort();
}

function isIpv6(address: string): boolean {
  return address.includes(":");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function listenerAddresses(host: string, trustedAddresses: readonly string[]): string[] {
  const normalized = host.trim().replace(/^\[|\]$/g, "");
  if (normalized === "0.0.0.0") {
    return trustedAddresses.filter((address) => !isIpv6(address));
  }
  if (normalized === "::") {
    return trustedAddresses.filter(isIpv6);
  }
  return trustedAddresses.filter((address) => address === normalized);
}

function formatUrlHost(address: string): string {
  return isIpv6(address) ? `[${address}]` : address;
}

export function buildLanAccessSnapshot(input: LanAccessSnapshotInput): LanAccessSnapshot {
  const trustedCidrs = [...input.policy.trustedLan.cidrs];
  if (!input.policy.trustedLan.enabled) {
    return {
      enabled: false,
      status: "disabled",
      trustedCidrs,
      cockpitUrls: [],
      apiBaseUrls: []
    };
  }

  if (isLoopbackHost(input.host)) {
    return {
      enabled: true,
      status: "listener-loopback",
      trustedCidrs,
      cockpitUrls: [],
      apiBaseUrls: []
    };
  }

  const addresses = input.addresses ? [...input.addresses] : systemLanAddresses();
  const trustedAddresses = [...new Set(addresses)]
    .map((address) => address.trim())
    .filter(Boolean)
    .filter((address) => isTrustedLanAddress(address, input.policy))
    .sort();
  const reachableAddresses = listenerAddresses(input.host, trustedAddresses);

  if (reachableAddresses.length === 0) {
    return {
      enabled: true,
      status: "no-trusted-address",
      trustedCidrs,
      cockpitUrls: [],
      apiBaseUrls: []
    };
  }

  const apiBaseUrls = reachableAddresses.map(
    (address) => `http://${formatUrlHost(address)}:${input.port}`
  );
  return {
    enabled: true,
    status: "ready",
    trustedCidrs,
    apiBaseUrls,
    cockpitUrls: apiBaseUrls.map(
      (baseUrl) => `${baseUrl}${input.consolePathPrefix}`
    )
  };
}
