import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBody,
  encodeBody,
  headersFromPairs,
  headersToPairs,
  isProxyErrorEnvelope,
  isProxyRequestEnvelope,
  isProxyResponseEnvelope,
} from "../../src/proxy/protocol.ts";

test("body encoding is binary safe", () => {
  const body = Uint8Array.from([0, 1, 127, 128, 255]);
  assert.deepEqual(decodeBody(encodeBody(body)), body);
});

test("header pairs preserve multiple set-cookie values", () => {
  const headers = headersFromPairs([
    ["content-type", "text/html"],
    ["set-cookie", "session=one; Path=/"],
    ["set-cookie", "access=two; Path=/"],
  ]);
  assert.deepEqual(headers.getSetCookie(), [
    "session=one; Path=/",
    "access=two; Path=/",
  ]);
  assert.deepEqual(
    headersToPairs(headers).filter(([name]) => name === "set-cookie"),
    [
      ["set-cookie", "session=one; Path=/"],
      ["set-cookie", "access=two; Path=/"],
    ],
  );
});

test("envelope guards reject malformed JSON", () => {
  assert.equal(isProxyRequestEnvelope({ method: "GET" }), false);
  assert.equal(isProxyResponseEnvelope({ status: "200" }), false);
  assert.equal(isProxyErrorEnvelope({ error: { code: 1 } }), false);
  assert.equal(
    isProxyRequestEnvelope({
      url: "https://prehraj.to/",
      method: "GET",
      headers: [["accept", "text/html"]],
    }),
    true,
  );
  assert.equal(
    isProxyResponseEnvelope({
      status: 200,
      statusText: "OK",
      headers: [],
      url: "https://prehraj.to/",
      bodyBase64: "",
      requestId: "request-1",
    }),
    true,
  );
  assert.equal(
    isProxyErrorEnvelope({
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "Upstream timed out",
        requestId: "request-1",
      },
    }),
    true,
  );
});
