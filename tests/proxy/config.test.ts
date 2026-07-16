import assert from "node:assert/strict";
import test from "node:test";

import {
  getProxyClientConfig,
  getProxyServerConfig,
} from "../../src/proxy/config.ts";

test("client proxy mode is disabled when both values are absent", () => {
  assert.equal(getProxyClientConfig({}), null);
});

test("client proxy mode requires URL and client token together", () => {
  assert.throws(
    () =>
      getProxyClientConfig({
        SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      }),
    /SERVICE_PROXY_CLIENT_TOKEN/,
  );
  assert.throws(
    () =>
      getProxyClientConfig({ SERVICE_PROXY_CLIENT_TOKEN: "secret" }),
    /SERVICE_PROXY_URL/,
  );
});

test("server token alone does not enable client mode", () => {
  assert.equal(
    getProxyClientConfig({ SERVICE_PROXY_TOKEN: "server-secret" }),
    null,
  );
});

test("server config defaults to the PrehrajTo hostname", () => {
  assert.deepEqual(getProxyServerConfig({ SERVICE_PROXY_TOKEN: "secret" }), {
    token: "secret",
    allowedHosts: new Set(["prehraj.to"]),
    debug: false,
  });
});

test("server config rejects an empty token and normalizes allowed hosts", () => {
  assert.throws(() => getProxyServerConfig({}), /SERVICE_PROXY_TOKEN/);
  const config = getProxyServerConfig({
    SERVICE_PROXY_TOKEN: "secret",
    SERVICE_PROXY_ALLOWED_HOSTS:
      " prehraj.to,cdn.prehraj.to,prehraj.to ",
    SERVICE_PROXY_DEBUG: "true",
  });
  assert.deepEqual([...config.allowedHosts], [
    "prehraj.to",
    "cdn.prehraj.to",
  ]);
  assert.equal(config.debug, true);
});

test("client relay URL must use HTTPS except on loopback", () => {
  assert.throws(
    () =>
      getProxyClientConfig({
        SERVICE_PROXY_URL: "http://relay.test/internal/service-proxy",
        SERVICE_PROXY_CLIENT_TOKEN: "secret",
      }),
    /HTTPS/,
  );
  assert.equal(
    getProxyClientConfig({
      SERVICE_PROXY_URL: "http://127.0.0.1:1234/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    })?.url.hostname,
    "127.0.0.1",
  );
});
