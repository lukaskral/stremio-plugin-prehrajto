import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROXY_REQUEST_BYTES,
  MAX_PROXY_RESPONSE_BYTES,
  type ProxyServerConfig,
} from "../../src/proxy/config.ts";
import { decodeBody, type ProxyRequestEnvelope } from "../../src/proxy/protocol.ts";
import {
  executeProxyRequest,
  type ProxyLogger,
  ProxyRelayError,
} from "../../src/proxy/relay.ts";

const serverConfig: ProxyServerConfig = {
  token: "secret",
  allowedHosts: new Set(["prehraj.to"]),
  debug: false,
};
const baseEnvelope: ProxyRequestEnvelope = {
  url: "https://prehraj.to/search?password=hidden",
  method: "GET",
  headers: [],
};
const silentLogger: ProxyLogger = { info: () => undefined, error: () => undefined };

function dependencies(fetchImpl: typeof fetch, logger = silentLogger) {
  return { fetchImpl, requestId: "request-1", logger };
}

test("rejects unsafe destinations and methods before fetching", async (t) => {
  const cases: Array<[string, Partial<ProxyRequestEnvelope>]> = [
    ["plain HTTP", { url: "http://prehraj.to/" }],
    ["embedded credentials", { url: "https://user:pass@prehraj.to/" }],
    ["unlisted host", { url: "https://example.com/" }],
    ["host suffix bypass", { url: "https://prehraj.to.example.com/" }],
    ["unlisted port", { url: "https://prehraj.to:8443/" }],
    ["unsupported method", { method: "CONNECT" }],
  ];

  for (const [name, patch] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        return new Response();
      }) satisfies typeof fetch;
      await assert.rejects(
        executeProxyRequest(
          { ...baseEnvelope, ...patch },
          serverConfig,
          dependencies(fetchImpl),
        ),
        ProxyRelayError,
      );
      assert.equal(calls, 0);
    });
  }
});

test("strips hop-by-hop request headers", async () => {
  let upstreamHeaders = new Headers();
  const fetchImpl = (async (_input, init) => {
    upstreamHeaders = new Headers(init?.headers);
    return new Response("ok");
  }) satisfies typeof fetch;
  await executeProxyRequest(
    {
      ...baseEnvelope,
      headers: [
        ["accept", "text/html"],
        ["authorization", "upstream-auth"],
        ["connection", "keep-alive"],
        ["content-length", "123"],
        ["host", "evil.test"],
        ["proxy-authorization", "relay-secret"],
        ["transfer-encoding", "chunked"],
      ],
    },
    serverConfig,
    dependencies(fetchImpl),
  );
  assert.equal(upstreamHeaders.get("accept"), "text/html");
  assert.equal(upstreamHeaders.get("authorization"), "upstream-auth");
  for (const name of [
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "transfer-encoding",
  ]) {
    assert.equal(upstreamHeaders.has(name), false);
  }
});

test("follows same-host redirects and reports the final response", async () => {
  const urls: string[] = [];
  const responses = [
    new Response(null, { status: 302, headers: { location: "/next" } }),
    new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  ];
  const fetchImpl = (async (input) => {
    urls.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("Unexpected upstream request");
    return response;
  }) satisfies typeof fetch;
  const result = await executeProxyRequest(
    baseEnvelope,
    serverConfig,
    dependencies(fetchImpl),
  );
  assert.deepEqual(urls, [
    "https://prehraj.to/search?password=hidden",
    "https://prehraj.to/next",
  ]);
  assert.equal(result.url, "https://prehraj.to/next");
  assert.equal(Buffer.from(decodeBody(result.bodyBase64)).toString(), "ok");
});

test("blocks redirects to a non-allowlisted host", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://example.com/escape" },
    });
  }) satisfies typeof fetch;
  await assert.rejects(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
    (error: unknown) =>
      error instanceof ProxyRelayError &&
      error.code === "FORBIDDEN_DESTINATION",
  );
  assert.equal(calls, 1);
});

test("caps redirect chains", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `/redirect-${calls}` },
    });
  }) satisfies typeof fetch;
  await assert.rejects(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
    (error: unknown) =>
      error instanceof ProxyRelayError && error.code === "TOO_MANY_REDIRECTS",
  );
  assert.equal(calls, 6);
});

test("converts POST to GET for a 302 redirect", async () => {
  const methods: string[] = [];
  const bodies: Array<RequestInit["body"]> = [];
  const responses = [
    new Response(null, { status: 302, headers: { location: "/done" } }),
    new Response("ok"),
  ];
  const fetchImpl = (async (_input, init) => {
    methods.push(String(init?.method));
    bodies.push(init?.body);
    return responses.shift() as Response;
  }) satisfies typeof fetch;
  await executeProxyRequest(
    {
      url: "https://prehraj.to/login",
      method: "POST",
      headers: [["content-type", "application/x-www-form-urlencoded"]],
      bodyBase64: Buffer.from("email=test").toString("base64"),
    },
    serverConfig,
    dependencies(fetchImpl),
  );
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal(bodies[1], undefined);
});

test("enforces decoded request and response size limits", async (t) => {
  await t.test("request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response();
    }) satisfies typeof fetch;
    await assert.rejects(
      executeProxyRequest(
        {
          ...baseEnvelope,
          method: "POST",
          bodyBase64: Buffer.alloc(MAX_PROXY_REQUEST_BYTES + 1).toString(
            "base64",
          ),
        },
        serverConfig,
        dependencies(fetchImpl),
      ),
      (error: unknown) =>
        error instanceof ProxyRelayError && error.code === "REQUEST_TOO_LARGE",
    );
    assert.equal(calls, 0);
  });

  await t.test("response", async () => {
    const fetchImpl = (async () =>
      new Response(Buffer.alloc(MAX_PROXY_RESPONSE_BYTES + 1))) satisfies typeof fetch;
    await assert.rejects(
      executeProxyRequest(
        baseEnvelope,
        serverConfig,
        dependencies(fetchImpl),
      ),
      (error: unknown) =>
        error instanceof ProxyRelayError &&
        error.code === "RESPONSE_TOO_LARGE",
    );
  });
});

test("maps upstream aborts to a timeout error", async () => {
  const fetchImpl = (async () => {
    throw new DOMException("Timed out", "AbortError");
  }) satisfies typeof fetch;
  await assert.rejects(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
    (error: unknown) =>
      error instanceof ProxyRelayError && error.code === "UPSTREAM_TIMEOUT",
  );
});

test("logs sanitized summaries and optional redirect diagnostics", async () => {
  const messages: unknown[][] = [];
  const logger: ProxyLogger = {
    info: (...args: unknown[]) => messages.push(args),
    error: (...args: unknown[]) => messages.push(args),
  };
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: "/next?token=redirect-secret" },
    }),
    new Response("ok"),
  ];
  const fetchImpl = (async () => responses.shift() as Response) satisfies typeof fetch;
  await executeProxyRequest(
    {
      ...baseEnvelope,
      headers: [
        ["cookie", "session=cookie-secret"],
        ["authorization", "upstream-secret"],
      ],
    },
    { ...serverConfig, debug: true },
    dependencies(fetchImpl, logger),
  );
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /request-1/);
  assert.match(serialized, /prehraj\.to/);
  assert.match(serialized, /\/search|\/next/);
  assert.doesNotMatch(
    serialized,
    /hidden|redirect-secret|cookie-secret|upstream-secret/,
  );
  assert.ok(messages.length >= 2);
});
