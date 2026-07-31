import { expect, it } from "vitest";

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

const cases: Array<[string, Partial<ProxyRequestEnvelope>]> = [
  ["plain HTTP", { url: "http://prehraj.to/" }],
  ["embedded credentials", { url: "https://user:pass@prehraj.to/" }],
  ["unlisted host", { url: "https://example.com/" }],
  ["host suffix bypass", { url: "https://prehraj.to.example.com/" }],
  ["unlisted port", { url: "https://prehraj.to:8443/" }],
  ["unsupported method", { method: "CONNECT" }],
];

it.each(cases)(
  "rejects unsafe destination or method: %s",
  async (_name, patch) => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response();
    }) satisfies typeof fetch;
    await expect(
      executeProxyRequest(
        { ...baseEnvelope, ...patch },
        serverConfig,
        dependencies(fetchImpl),
      ),
    ).rejects.toBeInstanceOf(ProxyRelayError);
    expect(calls).toBe(0);
  },
);

it("strips hop-by-hop request headers", async () => {
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
  expect(upstreamHeaders.get("accept")).toBe("text/html");
  expect(upstreamHeaders.get("authorization")).toBe("upstream-auth");
  for (const name of [
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "transfer-encoding",
  ]) {
    expect(upstreamHeaders.has(name)).toBe(false);
  }
});

it("follows same-host redirects and reports the final response", async () => {
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
  expect(urls).toEqual([
    "https://prehraj.to/search?password=hidden",
    "https://prehraj.to/next",
  ]);
  expect(result.url).toBe("https://prehraj.to/next");
  expect(Buffer.from(decodeBody(result.bodyBase64)).toString()).toBe("ok");
});

it("blocks redirects to a non-allowlisted host", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://example.com/escape" },
    });
  }) satisfies typeof fetch;
  await expect(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
  expect(calls).toBe(1);
});

it("caps redirect chains", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `/redirect-${calls}` },
    });
  }) satisfies typeof fetch;
  await expect(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
  ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  expect(calls).toBe(6);
});

it("converts POST to GET for a 302 redirect", async () => {
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
  expect(methods).toEqual(["POST", "GET"]);
  expect(bodies[1]).toBeUndefined();
});

it("rejects oversized decoded request bodies", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response();
  }) satisfies typeof fetch;
  await expect(
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
  ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  expect(calls).toBe(0);
});

it("rejects oversized decoded response bodies", async () => {
  const fetchImpl = (async () =>
    new Response(Buffer.alloc(MAX_PROXY_RESPONSE_BYTES + 1))) satisfies typeof fetch;
  await expect(
    executeProxyRequest(baseEnvelope, serverConfig, dependencies(fetchImpl)),
  ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
});

it("maps upstream aborts to a timeout error", async () => {
  const fetchImpl = (async () => {
    throw new DOMException("Timed out", "AbortError");
  }) satisfies typeof fetch;
  await expect(
    executeProxyRequest(
      baseEnvelope,
      serverConfig,
      dependencies(fetchImpl),
    ),
  ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
});

it("logs sanitized summaries and optional redirect diagnostics", async () => {
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
  expect(serialized).toMatch(/request-1/);
  expect(serialized).toMatch(/prehraj\.to/);
  expect(serialized).toMatch(/\/search|\/next/);
  expect(serialized).not.toMatch(/hidden|redirect-secret|cookie-secret|upstream-secret/);
  expect(messages.length).toBeGreaterThanOrEqual(2);
});
