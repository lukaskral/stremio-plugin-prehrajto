import { describe, expect, it, vi } from "vitest";

import { validateProxyEndpoint } from "../../src/proxy/targetPolicy.ts";

const publicAddress = { address: "93.184.216.34", family: 4 as const };

describe("proxy endpoint policy", () => {
  it.each([
    "not a URL",
    "http://proxy.example.test/proxy",
    "https://user:password@proxy.example.test/proxy",
    "https://proxy.example.test/",
    "https://proxy.example.test/proxy/",
    "https://proxy.example.test/other",
    "https://proxy.example.test:8443/proxy",
    "https://proxy.example.test/proxy?secret=value",
    "https://proxy.example.test/proxy#fragment",
  ])("rejects malformed or unsafe endpoint %s", async (rawUrl) => {
    await expect(
      validateProxyEndpoint(rawUrl, {
        resolveHostname: vi.fn(async () => [publicAddress]),
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "::ffff:192.168.1.1",
    "2001::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "4000::1",
  ])("rejects non-global address %s", async (address) => {
    await expect(
      validateProxyEndpoint("https://proxy.example.test/proxy", {
        resolveHostname: vi.fn(async () => [
          { address, family: address.includes(":") ? 6 : 4 },
        ]),
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
  });

  it("accepts a known public IPv6 address", async () => {
    await expect(
      validateProxyEndpoint("https://proxy.example.test/proxy", {
        resolveHostname: vi.fn(async () => [
          { address: "2606:4700:4700::1111", family: 6 },
        ]),
      }),
    ).resolves.toMatchObject({
      connection: {
        address: "2606:4700:4700::1111",
        family: 6,
      },
    });
  });

  it("bounds DNS resolution time and clears its deadline", async () => {
    vi.useFakeTimers();
    try {
      const validation = validateProxyEndpoint(
        "https://proxy.example.test/proxy",
        {
          resolveHostname: vi.fn(
            () => new Promise<readonly never[]>(() => undefined),
          ),
          resolveTimeoutMs: 25,
        },
      );
      const rejection = expect(validation).rejects.toThrow(
        "Proxy endpoint validation timed out",
      );

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose DNS resolution errors", async () => {
    await expect(
      validateProxyEndpoint("https://proxy.example.test/proxy", {
        resolveHostname: vi.fn(async () => {
          throw new Error("resolver leaked an internal hostname");
        }),
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
  });

  it("rejects a mixed safe and unsafe DNS response", async () => {
    await expect(
      validateProxyEndpoint("https://proxy.example.test/proxy", {
        resolveHostname: vi.fn(async () => [
          publicAddress,
          { address: "192.168.1.10", family: 4 },
        ]),
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
  });

  it("rejects empty and changing DNS results", async () => {
    const emptyLookup = vi.fn(async () => []);
    await expect(
      validateProxyEndpoint("https://proxy.example.test/proxy", {
        resolveHostname: emptyLookup,
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");

    const rebindingLookup = vi
      .fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const validated = await validateProxyEndpoint(
      "https://proxy.example.test/proxy",
      { resolveHostname: rebindingLookup },
    );
    expect(validated.connection.address).toBe(publicAddress.address);
    expect(rebindingLookup).toHaveBeenCalledTimes(1);
  });

  it("permits loopback HTTP only through the explicit test dependency", async () => {
    const resolveHostname = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 as const },
    ]);

    await expect(
      validateProxyEndpoint("http://localhost:1234/proxy", {
        resolveHostname,
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
    await expect(
      validateProxyEndpoint("http://localhost:1234/proxy", {
        resolveHostname,
        allowInsecureLoopback: true,
      }),
    ).resolves.toMatchObject({
      endpoint: new URL("http://localhost:1234/proxy"),
      connection: {
        address: "127.0.0.1",
        family: 4,
        servername: "localhost",
      },
    });
  });
});
