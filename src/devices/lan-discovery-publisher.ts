import { createHash } from "node:crypto";

import type { Answer } from "dns-packet";
import multicastDns from "multicast-dns";
import ipaddr from "ipaddr.js";

import {
  trustedLanListenerAddresses
} from "./lan-access.js";
import type { AccessPolicy } from "../security/access-policy.js";

const SERVICE_TYPE = "_chatcockpit._tcp.local";
const SERVICE_PROTOCOL_VERSION_LEGACY = "1";
const SERVICE_PROTOCOL_VERSION_SECURE = "2";
const SERVICE_ROLE = "hub";
const RECORD_TTL_SECONDS = 120;
const HUB_ID_PATTERN = /^cc_hub_[A-Za-z0-9_-]{43}$/;

export interface LanDiscoveryPublisherInput {
  policy: AccessPolicy;
  host: string;
  port: number;
  securePort?: number;
  hubId: string;
  addresses?: readonly string[];
  onError?(code: "PUBLISHER_ERROR"): void;
}

export interface LanDiscoveryPublication {
  advertised: boolean;
  interfaceAddresses: string[];
  instanceName: string;
  hostName: string;
  stop(): Promise<void>;
}

export interface LanDiscoveryPublisherService {
  start(input: LanDiscoveryPublisherInput): Promise<LanDiscoveryPublication>;
}

interface MdnsQuestionLike {
  name: string;
  type: string;
}

interface MdnsQueryLike {
  questions: MdnsQuestionLike[];
}

interface MdnsInstanceLike {
  on(event: "ready", listener: () => void): this;
  on(event: "query", listener: (query: MdnsQueryLike) => void): this;
  on(event: "error" | "warning", listener: () => void): this;
  respond(records: Answer[], callback?: (error: Error | null) => void): void;
  destroy(callback?: () => void): void;
}

export interface LanDiscoveryMdnsFactory {
  create(input: {
    interfaceAddress: string;
    family: "IPv4" | "IPv6";
  }): MdnsInstanceLike;
}

function defaultFactory(): LanDiscoveryMdnsFactory {
  return {
    create(input) {
      return multicastDns({
        interface: input.interfaceAddress,
        type: input.family === "IPv6" ? "udp6" : "udp4",
        ip: input.family === "IPv6" ? "ff02::fb" : "224.0.0.251",
        multicast: true,
        ttl: 255,
        loopback: false
      }) as unknown as MdnsInstanceLike;
    }
  };
}

function normalizeHubId(value: string): string {
  const normalized = value.trim();
  if (!HUB_ID_PATTERN.test(normalized)) throw new Error("LAN discovery Hub identity is invalid");
  return normalized;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("LAN discovery publisher port is invalid");
  }
  return value;
}

function localScopeAddress(value: string): { address: string; family: "IPv4" | "IPv6" } | null {
  if (!ipaddr.isValid(value)) return null;
  const parsed = ipaddr.parse(value);
  const range = parsed.range();
  if (range !== "private" && range !== "linkLocal" && range !== "uniqueLocal") return null;
  return {
    address: parsed.toString(),
    family: parsed.kind() === "ipv6" ? "IPv6" : "IPv4"
  };
}

function serviceSuffix(hubId: string): string {
  return createHash("sha256").update(hubId, "utf8").digest("hex").slice(0, 12);
}

function answerRecords(input: {
  instanceName: string;
  hostName: string;
  port: number;
  securePort?: number;
  hubId: string;
  address: string;
  family: "IPv4" | "IPv6";
  ttl?: number;
}): Answer[] {
  const ttl = input.ttl ?? RECORD_TTL_SECONDS;
  const fqdn = `${input.instanceName}.${SERVICE_TYPE}`;
  return [
    {
      name: SERVICE_TYPE,
      type: "PTR",
      ttl,
      data: fqdn
    },
    {
      name: fqdn,
      type: "SRV",
      ttl,
      data: {
        port: input.port,
        target: input.hostName,
        priority: 0,
        weight: 0
      }
    },
    {
      name: fqdn,
      type: "TXT",
      ttl,
      data: [
        Buffer.from(
          `v=${input.securePort === undefined ? SERVICE_PROTOCOL_VERSION_LEGACY : SERVICE_PROTOCOL_VERSION_SECURE}`,
          "utf8"
        ),
        Buffer.from(`role=${SERVICE_ROLE}`, "utf8"),
        Buffer.from(`hub=${input.hubId}`, "utf8"),
        ...(input.securePort === undefined
          ? []
          : [Buffer.from(`tls=${input.securePort}`, "utf8")])
      ]
    },
    {
      name: input.hostName,
      type: input.family === "IPv6" ? "AAAA" : "A",
      ttl,
      data: input.address
    }
  ];
}

function queryTargetsAdvertisement(query: MdnsQueryLike, input: {
  instanceName: string;
  hostName: string;
}): boolean {
  const fqdn = `${input.instanceName}.${SERVICE_TYPE}`.toLowerCase();
  const serviceType = SERVICE_TYPE.toLowerCase();
  const hostName = input.hostName.toLowerCase();
  return query.questions.some((question) => {
    const name = question.name.trim().replace(/\.$/, "").toLowerCase();
    return name === serviceType || name === fqdn || name === hostName;
  });
}

function send(instance: MdnsInstanceLike, records: Answer[], onError?: () => void): void {
  instance.respond(records, (error) => {
    if (error) onError?.();
  });
}

async function destroy(instance: MdnsInstanceLike): Promise<void> {
  await new Promise<void>((resolve) => instance.destroy(resolve));
}

export class LanDiscoveryPublisher implements LanDiscoveryPublisherService {
  readonly #factory: LanDiscoveryMdnsFactory;
  #active = false;

  constructor(factory: LanDiscoveryMdnsFactory = defaultFactory()) {
    this.#factory = factory;
  }

  async start(input: LanDiscoveryPublisherInput): Promise<LanDiscoveryPublication> {
    if (this.#active) throw new Error("LAN discovery publisher is already running");
    const hubId = normalizeHubId(input.hubId);
    const port = normalizePort(input.port);
    const securePort = input.securePort === undefined ? undefined : normalizePort(input.securePort);
    if (securePort === port) {
      throw new Error("LAN discovery publisher secure port must differ from the bootstrap port");
    }
    const suffix = serviceSuffix(hubId);
    const instanceName = `ChatCockpit Hub ${suffix}`;
    const hostName = `chatcockpit-${suffix}.local`;
    const listenerAddresses = trustedLanListenerAddresses({
      policy: input.policy,
      host: input.host,
      addresses: input.addresses
    });
    const interfaces = listenerAddresses
      .map(localScopeAddress)
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (interfaces.length === 0) {
      return {
        advertised: false,
        interfaceAddresses: [],
        instanceName,
        hostName,
        stop: async () => {}
      };
    }

    this.#active = true;
    const instances: Array<{
      mdns: MdnsInstanceLike;
      records: Answer[];
      address: string;
    }> = [];
    let stopped = false;

    try {
      for (const iface of interfaces) {
        const mdns = this.#factory.create({
          interfaceAddress: iface.address,
          family: iface.family
        });
        const records = answerRecords({
          instanceName,
          hostName,
          port,
          ...(securePort === undefined ? {} : { securePort }),
          hubId,
          address: iface.address,
          family: iface.family
        });
        const reportError = () => input.onError?.("PUBLISHER_ERROR");
        mdns.on("error", reportError);
        mdns.on("warning", reportError);
        mdns.on("ready", () => send(mdns, records, reportError));
        mdns.on("query", (query) => {
          if (queryTargetsAdvertisement(query, { instanceName, hostName })) {
            send(mdns, records, reportError);
          }
        });
        instances.push({ mdns, records, address: iface.address });
      }
    } catch (error) {
      this.#active = false;
      await Promise.all(instances.map(({ mdns }) => destroy(mdns).catch(() => {})));
      throw error;
    }

    return {
      advertised: true,
      interfaceAddresses: interfaces.map((iface) => iface.address),
      instanceName,
      hostName,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.#active = false;
        await Promise.all(instances.map(async ({ mdns, records }) => {
          const goodbye = records.map((record) => ({ ...record, ttl: 0 })) as Answer[];
          send(mdns, goodbye, () => input.onError?.("PUBLISHER_ERROR"));
          await destroy(mdns);
        }));
      }
    };
  }
}
