import { expect, it } from "vitest";

import {
  getProxyClientConfig,
  getProxyServerConfig,
} from "../../src/proxy/config.ts";

it("client proxy mode is disabled when both values are absent", () => {
  expect(getProxyClientConfig({})).toBeNull();
});

it("client proxy mode requires URL and client token together", () => {
  expect(
    () =>
      getProxyClientConfig({
        SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      }),
  ).toThrow(/SERVICE_PROXY_CLIENT_TOKEN/);
  expect(
    () =>
      getProxyClientConfig({ SERVICE_PROXY_CLIENT_TOKEN: "secret" }),
  ).toThrow(/SERVICE_PROXY_URL/);
});

it("server token alone does not enable client mode", () => {
  expect(getProxyClientConfig({ SERVICE_PROXY_TOKEN: "server-secret" })).toBeNull();
});

it("server config defaults to the PrehrajTo hostname", () => {
  expect(getProxyServerConfig({ SERVICE_PROXY_TOKEN: "secret" })).toEqual({
    token: "secret",
    allowedHosts: new Set(["prehraj.to"]),
    debug: false,
  });
});

it("server config rejects an empty token and normalizes allowed hosts", () => {
  expect(() => getProxyServerConfig({})).toThrow(/SERVICE_PROXY_TOKEN/);
  const config = getProxyServerConfig({
    SERVICE_PROXY_TOKEN: "secret",
    SERVICE_PROXY_ALLOWED_HOSTS:
      " prehraj.to,cdn.prehraj.to,prehraj.to ",
    SERVICE_PROXY_DEBUG: "true",
  });
  expect([...config.allowedHosts]).toEqual([
    "prehraj.to",
    "cdn.prehraj.to",
  ]);
  expect(config.debug).toBe(true);
});

it("client relay URL must use HTTPS except on loopback", () => {
  expect(
    () =>
      getProxyClientConfig({
        SERVICE_PROXY_URL: "http://relay.test/internal/service-proxy",
        SERVICE_PROXY_CLIENT_TOKEN: "secret",
      }),
  ).toThrow(/HTTPS/);
  expect(
    getProxyClientConfig({
      SERVICE_PROXY_URL: "http://127.0.0.1:1234/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    })?.url.hostname,
  ).toBe("127.0.0.1");
});
