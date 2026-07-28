import { describe, expect, it, vi } from "vitest";

import {
  parseProxyConfig,
  parseProxyQueryConfig,
  parseUserProxyConfig,
} from "../../src/proxy/config.ts";

const resolvePublicAddress = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 as const },
]);

describe("proxy configuration", () => {
  it("selects direct mode only when both values are absent", async () => {
    await expect(
      parseProxyConfig({}, { resolveHostname: resolvePublicAddress }),
    ).resolves.toEqual({ mode: "direct" });
    await expect(
      parseProxyConfig(
        { proxyUrl: "  ", proxyApiKey: "" },
        { resolveHostname: resolvePublicAddress },
      ),
    ).resolves.toEqual({ mode: "direct" });
  });

  it("requires the URL and API key together without exposing their values", async () => {
    await expect(
      parseProxyConfig(
        { proxyUrl: "https://proxy.example.test/proxy" },
        { resolveHostname: resolvePublicAddress },
      ),
    ).rejects.toThrow("Proxy URL and API key must be configured together");
    await expect(
      parseProxyConfig(
        { proxyApiKey: "very-secret-key" },
        { resolveHostname: resolvePublicAddress },
      ),
    ).rejects.toThrow("Proxy URL and API key must be configured together");
  });

  it("normalizes a valid proxy pair and retains the TLS hostname", async () => {
    const resolveHostname = vi.fn(async () => [
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ]);

    await expect(
      parseProxyConfig(
        {
          proxyUrl: "  https://Proxy.Example.Test:443/proxy  ",
          proxyApiKey: "  very-secret-key  ",
        },
        { resolveHostname },
      ),
    ).resolves.toEqual({
      mode: "proxy",
      endpoint: new URL("https://proxy.example.test/proxy"),
      apiKey: "very-secret-key",
      connection: {
        address: "2606:2800:220:1:248:1893:25c8:1946",
        family: 6,
        servername: "proxy.example.test",
      },
    });
    expect(resolveHostname).toHaveBeenCalledWith("proxy.example.test");
  });

  it("parses installed and test-query values through the same policy", async () => {
    const dependencies = { resolveHostname: resolvePublicAddress };
    const expected = await parseProxyConfig(
      {
        proxyUrl: "https://proxy.example.test/proxy",
        proxyApiKey: "secret",
      },
      dependencies,
    );

    await expect(
      parseUserProxyConfig(
        {
          proxyUrl: "https://proxy.example.test/proxy",
          proxyApiKey: "secret",
          prehrajtoUsername: "user",
        },
        dependencies,
      ),
    ).resolves.toEqual(expected);
    await expect(
      parseProxyQueryConfig(
        new URLSearchParams({
          proxyUrl: "https://proxy.example.test/proxy",
          proxyApiKey: "secret",
          q: "Movie",
        }),
        dependencies,
      ),
    ).resolves.toEqual(expected);
  });
});
