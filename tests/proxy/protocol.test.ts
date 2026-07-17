import { expect, it } from "vitest";

import {
  decodeBody,
  encodeBody,
  headersFromPairs,
  headersToPairs,
  isProxyErrorEnvelope,
  isProxyRequestEnvelope,
  isProxyResponseEnvelope,
} from "../../src/proxy/protocol.ts";

it("body encoding is binary safe", () => {
  const body = Uint8Array.from([0, 1, 127, 128, 255]);
  expect(decodeBody(encodeBody(body))).toEqual(body);
});

it("header pairs preserve multiple set-cookie values", () => {
  const headers = headersFromPairs([
    ["content-type", "text/html"],
    ["set-cookie", "session=one; Path=/"],
    ["set-cookie", "access=two; Path=/"],
  ]);
  expect(headers.getSetCookie()).toEqual([
    "session=one; Path=/",
    "access=two; Path=/",
  ]);
  expect(
    headersToPairs(headers).filter(([name]) => name === "set-cookie"),
  ).toEqual([
      ["set-cookie", "session=one; Path=/"],
      ["set-cookie", "access=two; Path=/"],
    ]);
});

it("envelope guards reject malformed JSON", () => {
  expect(isProxyRequestEnvelope({ method: "GET" })).toBe(false);
  expect(isProxyResponseEnvelope({ status: "200" })).toBe(false);
  expect(isProxyErrorEnvelope({ error: { code: 1 } })).toBe(false);
  expect(
    isProxyRequestEnvelope({
      url: "https://prehraj.to/",
      method: "GET",
      headers: [["accept", "text/html"]],
    }),
  ).toBe(true);
  expect(
    isProxyResponseEnvelope({
      status: 200,
      statusText: "OK",
      headers: [],
      url: "https://prehraj.to/",
      bodyBase64: "",
      requestId: "request-1",
    }),
  ).toBe(true);
  expect(
    isProxyErrorEnvelope({
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "Upstream timed out",
        requestId: "request-1",
      },
    }),
  ).toBe(true);
});
