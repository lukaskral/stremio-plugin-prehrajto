import { type IncomingMessage } from "node:http";

import { describe, expect, test } from "vitest";

import {
  createTrustProxy,
  getRequestOrigin,
  getServerOrigin,
  runWithServerOrigin,
} from "../src/serverOrigin.ts";

type FakeRequestOptions = {
  host?: string;
  remoteAddress?: string;
  encrypted?: boolean;
  forwardedHost?: string | string[];
  forwardedProto?: string | string[];
};

function fakeRequest({
  host,
  remoteAddress = "127.0.0.1",
  encrypted = false,
  forwardedHost,
  forwardedProto,
}: FakeRequestOptions): IncomingMessage {
  return {
    headers: {
      ...(host === undefined ? {} : { host }),
      ...(forwardedHost === undefined
        ? {}
        : { "x-forwarded-host": forwardedHost }),
      ...(forwardedProto === undefined
        ? {}
        : { "x-forwarded-proto": forwardedProto }),
    },
    socket: { encrypted, remoteAddress },
  } as unknown as IncomingMessage;
}

describe("getRequestOrigin", () => {
  test.each([
    [{ host: "homeassistant.local:52932" }, "http://homeassistant.local:52932"],
    [{ host: "[2001:db8::1]:52932" }, "http://[2001:db8::1]:52932"],
    [{ host: "secure.example", encrypted: true }, "https://secure.example"],
  ] satisfies Array<[FakeRequestOptions, string]>)(
    "derives a direct origin from %j",
    (options, expected) => {
      expect(getRequestOrigin(fakeRequest(options))).toBe(expected);
    },
  );

  test("uses sanitized forwarding headers from a trusted peer", () => {
    const trustProxy = createTrustProxy("10.0.0.0/8");
    const request = fakeRequest({
      host: "czstreams:52932",
      remoteAddress: "10.20.30.40",
      forwardedHost: "media.example.test:8443",
      forwardedProto: "https",
    });

    expect(getRequestOrigin(request, trustProxy)).toBe(
      "https://media.example.test:8443",
    );
  });

  test("uses the preserved Host header when a trusted proxy omits forwarded host", () => {
    const trustProxy = createTrustProxy("loopback");
    const request = fakeRequest({
      host: "media.example.test",
      forwardedProto: "https",
    });

    expect(getRequestOrigin(request, trustProxy)).toBe(
      "https://media.example.test",
    );
  });

  test("ignores forwarding headers from an untrusted peer", () => {
    const trustProxy = createTrustProxy("10.0.0.0/8");
    const request = fakeRequest({
      host: "homeassistant.local:52932",
      remoteAddress: "192.168.1.20",
      forwardedHost: "spoofed.example",
      forwardedProto: "https",
    });

    expect(getRequestOrigin(request, trustProxy)).toBe(
      "http://homeassistant.local:52932",
    );
  });

  test.each([
    [fakeRequest({}), "Request Host header is required"],
    [
      fakeRequest({ host: "user@example.test" }),
      "Request origin must not contain credentials",
    ],
    [
      fakeRequest({ host: "example.test/path" }),
      "Request origin must not contain a path, query, or fragment",
    ],
    [
      fakeRequest({
        host: "internal:52932",
        forwardedHost: "one.example,two.example",
        forwardedProto: "https",
      }),
      "X-Forwarded-Host must contain exactly one value",
    ],
    [
      fakeRequest({
        host: "internal:52932",
        forwardedHost: "media.example",
        forwardedProto: "https,http",
      }),
      "X-Forwarded-Proto must contain exactly one value",
    ],
    [
      fakeRequest({
        host: "internal:52932",
        forwardedHost: "media.example",
        forwardedProto: "ftp",
      }),
      "Request protocol must be http or https",
    ],
  ])("rejects an invalid effective origin", (request, message) => {
    expect(() =>
      getRequestOrigin(request, createTrustProxy("loopback")),
    ).toThrow(message);
  });

  test("rejects an invalid trusted proxy expression", () => {
    expect(() => createTrustProxy("not-an-ip-or-range")).toThrow();
  });
});

describe("server origin context", () => {
  test("fails explicitly outside an HTTP request context", () => {
    expect(() => getServerOrigin()).toThrow(
      "Server origin is unavailable outside an HTTP request",
    );
  });

  test("propagates the origin through asynchronous work", async () => {
    await expect(
      runWithServerOrigin("https://media.example", async () => {
        await Promise.resolve();
        return getServerOrigin();
      }),
    ).resolves.toBe("https://media.example");
  });

  test("isolates overlapping requests", async () => {
    const readAfterYield = (origin: string) =>
      runWithServerOrigin(origin, async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return getServerOrigin();
      });

    await expect(
      Promise.all([
        readAfterYield("https://one.example"),
        readAfterYield("https://two.example:8443"),
      ]),
    ).resolves.toEqual([
      "https://one.example",
      "https://two.example:8443",
    ]);
  });
});
