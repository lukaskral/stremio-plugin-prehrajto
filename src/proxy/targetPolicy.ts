import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ResolvedAddress = {
  address: string;
  family: number;
};

export type ProxyEndpointPolicyDependencies = {
  resolveHostname?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  resolveTimeoutMs?: number;
  allowInsecureLoopback?: boolean;
};

export type ValidatedProxyEndpoint = {
  endpoint: URL;
  connection: {
    address: string;
    family: 4 | 6;
    servername: string;
  };
};

const INVALID_ENDPOINT_ERROR = "Proxy endpoint is invalid or unsafe";
const ENDPOINT_VALIDATION_TIMEOUT_ERROR = "Proxy endpoint validation timed out";
const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;

async function defaultResolveHostname(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

function isInIpv4Range(address: number, base: string, prefix: number): boolean {
  const baseNumber = ipv4Number(base);
  if (baseNumber === null) {
    return false;
  }
  const blockSize = 2 ** (32 - prefix);
  return Math.floor(address / blockSize) === Math.floor(baseNumber / blockSize);
}

const NON_GLOBAL_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isGlobalIpv4(address: string): boolean {
  const value = ipv4Number(address);
  return (
    value !== null &&
    !NON_GLOBAL_IPV4_RANGES.some(([base, prefix]) =>
      isInIpv4Range(value, base, prefix),
    )
  );
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized.includes(".")) {
    return null;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

function hasIpv6Prefix(
  groups: number[],
  prefixGroups: number[],
  prefixLength: number,
): boolean {
  const fullGroups = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;
  for (let index = 0; index < fullGroups; index += 1) {
    if (groups[index] !== prefixGroups[index]) {
      return false;
    }
  }
  if (!remainingBits) {
    return true;
  }
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (groups[fullGroups] & mask) === (prefixGroups[fullGroups] & mask);
}

const NON_GLOBAL_IPV6_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

function isGlobalIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  // Fail closed: admit allocated global-unicast space only, then exclude
  // special-purpose prefixes even where a narrower exception may be routable.
  return (
    groups !== null &&
    hasIpv6Prefix(groups, [0x2000], 3) &&
    !NON_GLOBAL_IPV6_RANGES.some(([base, prefix]) => {
      const baseGroups = expandIpv6(base);
      return baseGroups !== null && hasIpv6Prefix(groups, baseGroups, prefix);
    })
  );
}

async function resolveHostnameBeforeDeadline(
  hostname: string,
  resolveHostname: (hostname: string) => Promise<readonly ResolvedAddress[]>,
  timeoutMs: number,
): Promise<readonly ResolvedAddress[]> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveHostname(hostname),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(ENDPOINT_VALIDATION_TIMEOUT_ERROR)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (deadline !== undefined) {
      clearTimeout(deadline);
    }
  }
}

function isGlobalAddress(address: ResolvedAddress): boolean {
  if (address.family === 4 && isIP(address.address) === 4) {
    return isGlobalIpv4(address.address);
  }
  if (address.family === 6 && isIP(address.address) === 6) {
    return isGlobalIpv6(address.address);
  }
  return false;
}

function isLoopbackAddress(address: ResolvedAddress): boolean {
  if (address.family === 4) {
    const value = ipv4Number(address.address);
    return value !== null && isInIpv4Range(value, "127.0.0.0", 8);
  }
  const groups = expandIpv6(address.address);
  const loopback = expandIpv6("::1");
  return (
    address.family === 6 &&
    groups !== null &&
    loopback !== null &&
    groups.every((group, index) => group === loopback[index])
  );
}

export async function validateProxyEndpoint(
  rawUrl: string,
  {
    resolveHostname = defaultResolveHostname,
    resolveTimeoutMs = DEFAULT_RESOLVE_TIMEOUT_MS,
    allowInsecureLoopback = false,
  }: ProxyEndpointPolicyDependencies = {},
): Promise<ValidatedProxyEndpoint> {
  try {
    const endpoint = new URL(rawUrl);
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isSecureRuntimeEndpoint =
      endpoint.protocol === "https:" &&
      endpoint.pathname === "/proxy" &&
      !endpoint.port;
    const isInjectedLoopbackEndpoint =
      allowInsecureLoopback &&
      endpoint.protocol === "http:" &&
      endpoint.pathname === "/proxy";

    if (
      (!isSecureRuntimeEndpoint && !isInjectedLoopbackEndpoint) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !hostname
    ) {
      throw new Error(INVALID_ENDPOINT_ERROR);
    }

    const addresses = await resolveHostnameBeforeDeadline(
      hostname,
      resolveHostname,
      resolveTimeoutMs,
    );
    const addressPolicy = isInjectedLoopbackEndpoint
      ? isLoopbackAddress
      : isGlobalAddress;
    if (
      addresses.length === 0 ||
      !addresses.every(
        (address) =>
          (address.family === 4 || address.family === 6) &&
          addressPolicy(address),
      )
    ) {
      throw new Error(INVALID_ENDPOINT_ERROR);
    }

    const pinnedAddress = addresses[0];
    return {
      endpoint,
      connection: {
        address: pinnedAddress.address,
        family: pinnedAddress.family as 4 | 6,
        servername: hostname,
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === ENDPOINT_VALIDATION_TIMEOUT_ERROR
    ) {
      throw new Error(ENDPOINT_VALIDATION_TIMEOUT_ERROR);
    }
    throw new Error(INVALID_ENDPOINT_ERROR);
  }
}
