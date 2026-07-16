# Service Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, opt-in relay that lets a local addon execute PrehrajTo login, search, and detail-page requests from the deployed server's network without proxying media.

**Architecture:** Route storage-service control requests through a `serviceFetch()` abstraction that defaults to direct `fetch` and optionally serializes requests to an authenticated endpoint on the existing addon server. Keep transport protocol, environment parsing, SSRF validation, relay execution, and HTTP endpoint adaptation in separate modules so each security boundary can be tested independently.

**Tech Stack:** Node.js 24 built-in `fetch`, `Request`, `Response`, `AbortSignal`, `node:test`, TypeScript, Express 5 request/response types, ESLint.

---

## File map

- Create `src/proxy/config.ts`: parse client and server environment configuration and define fixed relay limits.
- Create `src/proxy/protocol.ts`: define JSON envelopes and binary/header serialization helpers.
- Create `src/proxy/serviceFetch.ts`: select direct or proxied transport and reconstruct standard responses.
- Create `src/proxy/relay.ts`: validate destinations, filter headers, follow safe redirects, enforce limits, and execute upstream requests.
- Create `src/endpoints/serviceProxy.ts`: authenticate, parse the bounded JSON body, call the relay, and format structured results/errors.
- Modify `server.ts`: register `/internal/service-proxy` before SDK fallback routing.
- Modify `src/service/prehrajto.ts`: use `serviceFetch` for the four control-plane fetch calls only.
- Modify `src/endpoints/test.ts`: remove committed credentials and read optional debug credentials from the environment.
- Create `tests/proxy/config.test.ts`: configuration parsing tests.
- Create `tests/proxy/protocol.test.ts`: protocol and duplicate-header tests.
- Create `tests/proxy/serviceFetch.test.ts`: direct/proxy selection and client error tests.
- Create `tests/proxy/relay.test.ts`: SSRF, redirect, size, timeout, and redaction tests.
- Create `tests/proxy/serviceProxy.integration.test.ts`: end-to-end local client, relay, and fake-upstream test.
- Modify `package.json` and `package-lock.json`: add Node type declarations and automated test commands.
- Modify `tsconfig.json`: type-check server entrypoints and tests.
- Modify `src/endpoints/cleanup.ts`: replace an existing `any` catch variable so the documented full lint command can pass.
- Modify `.gitignore`: exclude local environment files while retaining an example.
- Create `.env.example`: document variable names without secrets.
- Create `README.md`: document deployment, local use, limits, and manual verification.

## Fixed protocol and safety constants

Use these values consistently in code and tests:

```ts
export const DEFAULT_ALLOWED_HOSTS = ["prehraj.to"];
export const MAX_PROXY_ENVELOPE_BYTES = 512 * 1024;
export const MAX_PROXY_REQUEST_BYTES = 256 * 1024;
export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;
export const PROXY_TIMEOUT_MS = 15_000;
export const MAX_PROXY_REDIRECTS = 5;
export const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST"]);
```

The endpoint itself accepts only `POST`; `ALLOWED_PROXY_METHODS` applies to the serialized upstream request.

### Task 1: Establish the automated test harness and configuration contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `src/endpoints/cleanup.ts`
- Create: `src/proxy/config.ts`
- Create: `tests/proxy/config.test.ts`

- [ ] **Step 1: Add explicit Node typings and test scripts**

Run:

```bash
npm install --save-dev @types/node
```

Replace the existing test script and retain the live network script under a new name:

```json
"scripts": {
  "build": "tsc",
  "start": "node --experimental-strip-types server.ts",
  "start:install": "node --experimental-strip-types server.ts --install",
  "check": "npm run check:tsc && npm run check:lint",
  "check:tsc": "tsc --noEmit",
  "check:lint": "eslint .",
  "test": "node --experimental-strip-types --test tests/**/*.test.ts",
  "test:live": "node --experimental-strip-types test.ts",
  "proxy": "npx proxy-lists getProxies --countries=\"cz,sk\" --anonymity-levels=\"elite\" --stdout"
}
```

Change `tsconfig.json` to include the runnable entrypoints and tests:

```json
"include": [
  "addon.ts",
  "server.ts",
  "src/**/*",
  "tests/**/*"
]
```

The existing lint baseline has three `no-explicit-any` errors. Two are in files this feature later changes. Fix the remaining one in `src/endpoints/cleanup.ts` now:

```ts
  } catch (e: unknown) {
    res.write(String(e) + NL);
    res.end("error");
  }
```

- [ ] **Step 2: Write failing configuration tests**

Create `tests/proxy/config.test.ts` with tests that assert:

```ts
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
    () => getProxyClientConfig({ SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy" }),
    /SERVICE_PROXY_CLIENT_TOKEN/,
  );
  assert.throws(
    () => getProxyClientConfig({ SERVICE_PROXY_CLIENT_TOKEN: "secret" }),
    /SERVICE_PROXY_URL/,
  );
});

test("server token alone does not enable client mode", () => {
  assert.equal(getProxyClientConfig({ SERVICE_PROXY_TOKEN: "server-secret" }), null);
});

test("server config defaults to the PrehrajTo hostname", () => {
  assert.deepEqual(
    getProxyServerConfig({ SERVICE_PROXY_TOKEN: "secret" }),
    {
      token: "secret",
      allowedHosts: new Set(["prehraj.to"]),
      debug: false,
    },
  );
});

test("server config rejects an empty token and normalizes allowed hosts", () => {
  assert.throws(() => getProxyServerConfig({}), /SERVICE_PROXY_TOKEN/);
  const config = getProxyServerConfig({
    SERVICE_PROXY_TOKEN: "secret",
    SERVICE_PROXY_ALLOWED_HOSTS: " prehraj.to,cdn.prehraj.to,prehraj.to ",
    SERVICE_PROXY_DEBUG: "true",
  });
  assert.deepEqual([...config.allowedHosts], ["prehraj.to", "cdn.prehraj.to"]);
  assert.equal(config.debug, true);
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
npm test -- tests/proxy/config.test.ts
```

Expected: FAIL because `src/proxy/config.ts` does not exist.

- [ ] **Step 4: Implement configuration parsing and shared constants**

Create `src/proxy/config.ts` with these exports and rules:

```ts
export type Environment = Record<string, string | undefined>;

export type ProxyClientConfig = {
  url: URL;
  token: string;
};

export type ProxyServerConfig = {
  token: string;
  allowedHosts: Set<string>;
  debug: boolean;
};

export const DEFAULT_ALLOWED_HOSTS = ["prehraj.to"];
export const MAX_PROXY_ENVELOPE_BYTES = 512 * 1024;
export const MAX_PROXY_REQUEST_BYTES = 256 * 1024;
export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;
export const PROXY_TIMEOUT_MS = 15_000;
export const MAX_PROXY_REDIRECTS = 5;
export const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST"]);

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} must be configured`);
  return normalized;
}

export function getProxyClientConfig(
  env: Environment = process.env,
): ProxyClientConfig | null {
  const rawUrl = env.SERVICE_PROXY_URL?.trim();
  const rawToken = env.SERVICE_PROXY_CLIENT_TOKEN?.trim();
  if (!rawUrl && !rawToken) return null;
  if (!rawUrl) throw new Error("SERVICE_PROXY_URL must be configured with SERVICE_PROXY_CLIENT_TOKEN");
  if (!rawToken) throw new Error("SERVICE_PROXY_CLIENT_TOKEN must be configured with SERVICE_PROXY_URL");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("SERVICE_PROXY_URL must use HTTPS except for local tests");
  }
  return { url, token: rawToken };
}

export function getProxyServerConfig(
  env: Environment = process.env,
): ProxyServerConfig {
  const token = requiredValue(env.SERVICE_PROXY_TOKEN, "SERVICE_PROXY_TOKEN");
  const hosts = (env.SERVICE_PROXY_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) throw new Error("SERVICE_PROXY_ALLOWED_HOSTS must contain a hostname");
  return {
    token,
    allowedHosts: new Set(hosts),
    debug: env.SERVICE_PROXY_DEBUG?.toLowerCase() === "true",
  };
}
```

- [ ] **Step 5: Run configuration tests and checks**

Run:

```bash
npm test -- tests/proxy/config.test.ts
npm run check:tsc
```

Expected: configuration tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit the configuration foundation**

```bash
git add package.json package-lock.json tsconfig.json src/endpoints/cleanup.ts src/proxy/config.ts tests/proxy/config.test.ts
git commit -m "test: establish service proxy configuration"
```

### Task 2: Define the binary-safe relay protocol

**Files:**
- Create: `src/proxy/protocol.ts`
- Create: `tests/proxy/protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Create `tests/proxy/protocol.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBody,
  encodeBody,
  headersFromPairs,
  headersToPairs,
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
  assert.deepEqual(headersToPairs(headers).filter(([name]) => name === "set-cookie"), [
    ["set-cookie", "session=one; Path=/"],
    ["set-cookie", "access=two; Path=/"],
  ]);
});

test("response envelope guard rejects malformed JSON", () => {
  assert.equal(isProxyResponseEnvelope({ status: "200" }), false);
  assert.equal(isProxyResponseEnvelope({
    status: 200,
    statusText: "OK",
    headers: [],
    url: "https://prehraj.to/",
    bodyBase64: "",
    requestId: "request-1",
  }), true);
});
```

- [ ] **Step 2: Run the protocol tests and verify they fail**

Run `npm test -- tests/proxy/protocol.test.ts`.

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement the protocol types and helpers**

Create `src/proxy/protocol.ts` with:

```ts
export type HeaderPair = [name: string, value: string];

export type ProxyRequestEnvelope = {
  url: string;
  method: string;
  headers: HeaderPair[];
  bodyBase64?: string;
};

export type ProxyResponseEnvelope = {
  status: number;
  statusText: string;
  headers: HeaderPair[];
  url: string;
  bodyBase64: string;
  requestId: string;
};

export type ProxyErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export function encodeBody(body: ArrayBuffer | Uint8Array): string {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  return Buffer.from(bytes).toString("base64");
}

export function decodeBody(bodyBase64 = ""): Uint8Array {
  return new Uint8Array(Buffer.from(bodyBase64, "base64"));
}

export function headersToPairs(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => {
    if (name !== "set-cookie") pairs.push([name, value]);
  });
  for (const cookie of headers.getSetCookie()) pairs.push(["set-cookie", cookie]);
  return pairs;
}

export function headersFromPairs(pairs: HeaderPair[]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) headers.append(name, value);
  return headers;
}

export function isProxyResponseEnvelope(value: unknown): value is ProxyResponseEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProxyResponseEnvelope>;
  return typeof item.status === "number"
    && typeof item.statusText === "string"
    && Array.isArray(item.headers)
    && typeof item.url === "string"
    && typeof item.bodyBase64 === "string"
    && typeof item.requestId === "string";
}

export function isProxyErrorEnvelope(value: unknown): value is ProxyErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as ProxyErrorEnvelope).error;
  return typeof error?.code === "string"
    && typeof error.message === "string"
    && typeof error.requestId === "string";
}
```

- [ ] **Step 4: Run protocol tests and commit**

```bash
npm test -- tests/proxy/protocol.test.ts
git add src/proxy/protocol.ts tests/proxy/protocol.test.ts
git commit -m "feat: define service proxy protocol"
```

Expected: tests PASS before the commit.

### Task 3: Build the direct-or-proxied `serviceFetch` client

**Files:**
- Create: `src/proxy/serviceFetch.ts`
- Create: `tests/proxy/serviceFetch.test.ts`

- [ ] **Step 1: Write failing transport-selection tests**

Create `tests/proxy/serviceFetch.test.ts`. Use an injected fetch function and cover these exact cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { createServiceFetch } from "../../src/proxy/serviceFetch.ts";
import type { ProxyResponseEnvelope } from "../../src/proxy/protocol.ts";

test("direct mode delegates to fetch unchanged", async () => {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push([input, init]);
    return new Response("direct", { status: 200 });
  };
  const serviceFetch = createServiceFetch({ env: {}, fetchImpl });
  assert.equal(await (await serviceFetch("https://prehraj.to/")).text(), "direct");
  assert.equal(calls.length, 1);
});

test("proxy mode serializes multipart requests and reconstructs cookies", async () => {
  let envelope: Record<string, unknown> | undefined;
  const proxyResponse: ProxyResponseEnvelope = {
    status: 200,
    statusText: "OK",
    headers: [["set-cookie", "access_token=abc; Path=/"]],
    url: "https://prehraj.to/login",
    bodyBase64: Buffer.from("logged-in").toString("base64"),
    requestId: "request-1",
  };
  const fetchImpl: typeof fetch = async (_input, init) => {
    envelope = JSON.parse(String(init?.body));
    return Response.json(proxyResponse);
  };
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  const form = new FormData();
  form.set("email", "person@example.test");
  const response = await serviceFetch("https://prehraj.to/login", { method: "POST", body: form });
  assert.match(String((envelope?.headers as string[][]).find(([name]) => name === "content-type")?.[1]), /multipart\/form-data; boundary=/);
  assert.ok(typeof envelope?.bodyBase64 === "string");
  assert.deepEqual(response.headers.getSetCookie(), ["access_token=abc; Path=/"]);
  assert.equal(await response.text(), "logged-in");
});

test("proxy errors include safe request context", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    error: { code: "UPSTREAM_TIMEOUT", message: "Upstream request timed out", requestId: "request-2" },
  }, { status: 504 });
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  await assert.rejects(
    serviceFetch("https://prehraj.to/private?password=hidden"),
    /UPSTREAM_TIMEOUT.*request-2/,
  );
});
```

- [ ] **Step 2: Run the client tests and verify they fail**

Run `npm test -- tests/proxy/serviceFetch.test.ts`.

Expected: FAIL because `createServiceFetch` does not exist.

- [ ] **Step 3: Implement the transport factory**

Create `src/proxy/serviceFetch.ts` with this interface and flow:

```ts
import { getProxyClientConfig, type Environment } from "./config.ts";
import {
  decodeBody,
  encodeBody,
  headersFromPairs,
  headersToPairs,
  isProxyErrorEnvelope,
  isProxyResponseEnvelope,
  type ProxyRequestEnvelope,
} from "./protocol.ts";

type ServiceFetchDependencies = {
  env?: Environment;
  fetchImpl?: typeof fetch;
};

export function createServiceFetch({
  env = process.env,
  fetchImpl = globalThis.fetch,
}: ServiceFetchDependencies = {}): typeof fetch {
  const config = getProxyClientConfig(env);
  if (!config) return fetchImpl;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : encodeBody(await request.clone().arrayBuffer());
    const envelope: ProxyRequestEnvelope = {
      url: request.url,
      method: request.method,
      headers: headersToPairs(request.headers),
      ...(body ? { bodyBase64: body } : {}),
    };
    const relayResponse = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: init?.signal,
    });
    const payload: unknown = await relayResponse.json();
    if (!relayResponse.ok) {
      if (isProxyErrorEnvelope(payload)) {
        throw new Error(`Service proxy ${payload.error.code} (${payload.error.requestId}): ${payload.error.message}`);
      }
      throw new Error(`Service proxy returned HTTP ${relayResponse.status}`);
    }
    if (!isProxyResponseEnvelope(payload)) throw new Error("Service proxy returned a malformed response");
    return new Response(decodeBody(payload.bodyBase64), {
      status: payload.status,
      statusText: payload.statusText,
      headers: headersFromPairs(payload.headers),
    });
  };
}

export const serviceFetch = createServiceFetch();
```

Do not log target URLs or payloads in the client.

- [ ] **Step 4: Run client and protocol tests**

```bash
npm test -- tests/proxy/serviceFetch.test.ts tests/proxy/protocol.test.ts
npm run check:tsc
```

Expected: all selected tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the client transport**

```bash
git add src/proxy/serviceFetch.ts tests/proxy/serviceFetch.test.ts
git commit -m "feat: add optional proxied service fetch"
```

### Task 4: Implement the secure relay core

**Files:**
- Create: `src/proxy/relay.ts`
- Create: `tests/proxy/relay.test.ts`

- [ ] **Step 1: Write failing destination and method validation tests**

Create a `baseEnvelope` targeting `https://prehraj.to/search`, inject a fetch spy, and assert `executeProxyRequest()` rejects each of these without calling the spy:

```ts
for (const [name, patch] of [
  ["plain HTTP", { url: "http://prehraj.to/" }],
  ["embedded credentials", { url: "https://user:pass@prehraj.to/" }],
  ["unlisted host", { url: "https://example.com/" }],
  ["host suffix bypass", { url: "https://prehraj.to.example.com/" }],
  ["unlisted port", { url: "https://prehraj.to:8443/" }],
  ["unsupported method", { method: "CONNECT" }],
] as const) {
  test(`rejects ${name}`, async () => {
    let calls = 0;
    await assert.rejects(
      executeProxyRequest({ ...baseEnvelope, ...patch }, serverConfig, {
        fetchImpl: async () => { calls += 1; return new Response(); },
        requestId: "request-1",
        logger: silentLogger,
      }),
      ProxyRelayError,
    );
    assert.equal(calls, 0);
  });
}
```

Also assert hop-by-hop headers (`host`, `connection`, `content-length`, `proxy-authorization`, `transfer-encoding`) are absent from the injected upstream request.

- [ ] **Step 2: Write failing redirect, limit, timeout, and logging tests**

Write table-driven tests using these exact scenarios and expected error codes:

- a redirect from `https://prehraj.to/start` to `/next` succeeds;
- a redirect to `https://example.com/escape` fails before the second fetch;
- more than five redirects produces `TOO_MANY_REDIRECTS`;
- a decoded request body larger than 256 KiB produces `REQUEST_TOO_LARGE`;
- a response body larger than 5 MiB produces `RESPONSE_TOO_LARGE`;
- an aborted injected fetch is reported as `UPSTREAM_TIMEOUT`;
- summary logs contain method, hostname, pathname, status, duration, and byte counts;
- summary logs do not contain query values, cookies, authorization, or request bodies.
- debug mode emits sanitized redirect lifecycle entries, while normal mode emits only the final summary.

Use a response sequence helper so redirect expectations are explicit:

```ts
const sequenceFetch = (responses: Response[]): typeof fetch => async () => {
  const response = responses.shift();
  if (!response) throw new Error("Unexpected upstream request");
  return response;
};

await executeProxyRequest(baseEnvelope, serverConfig, {
  fetchImpl: sequenceFetch([
    new Response(null, { status: 302, headers: { location: "/next" } }),
    new Response("ok", { status: 200 }),
  ]),
  requestId: "request-redirect",
  logger: silentLogger,
});

await assert.rejects(
  executeProxyRequest(baseEnvelope, serverConfig, {
    fetchImpl: sequenceFetch([
      new Response(null, { status: 302, headers: { location: "https://example.com/escape" } }),
    ]),
    requestId: "request-escape",
    logger: silentLogger,
  }),
  (error: unknown) => error instanceof ProxyRelayError && error.code === "FORBIDDEN_DESTINATION",
);

await assert.rejects(
  executeProxyRequest({
    ...baseEnvelope,
    method: "POST",
    bodyBase64: Buffer.alloc(MAX_PROXY_REQUEST_BYTES + 1).toString("base64"),
  }, serverConfig, dependencies),
  (error: unknown) => error instanceof ProxyRelayError && error.code === "REQUEST_TOO_LARGE",
);
```

For response size, return `Buffer.alloc(MAX_PROXY_RESPONSE_BYTES + 1)`. For timeout, inject a fetch implementation that rejects with a `DOMException("Timed out", "AbortError")`. For redirect count, return six same-host 302 responses. Assert the codes are `RESPONSE_TOO_LARGE`, `UPSTREAM_TIMEOUT`, and `TOO_MANY_REDIRECTS`, respectively.

Use an in-memory logger:

```ts
const messages: unknown[][] = [];
const logger = { info: (...args: unknown[]) => messages.push(args), error: (...args: unknown[]) => messages.push(args) };
```

- [ ] **Step 3: Run relay tests and verify they fail**

Run `npm test -- tests/proxy/relay.test.ts`.

Expected: FAIL because the relay module does not exist.

- [ ] **Step 4: Implement typed relay errors and URL validation**

Create `src/proxy/relay.ts` with these public contracts:

```ts
export class ProxyRelayError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProxyRelayError";
  }
}

export type ProxyLogger = Pick<Console, "info" | "error">;

export type RelayDependencies = {
  fetchImpl?: typeof fetch;
  requestId: string;
  logger?: ProxyLogger;
  timeoutMs?: number;
};

export async function executeProxyRequest(
  envelope: ProxyRequestEnvelope,
  config: ProxyServerConfig,
  dependencies: RelayDependencies,
): Promise<ProxyResponseEnvelope>;
```

Implement `validateTarget(rawUrl, allowedHosts)` to require HTTPS, no username/password, exact lower-case hostname membership, and either no explicit port or port `443`. Validate that the envelope has a string URL/method, an array of two-string header tuples, and an optional base64 body.

- [ ] **Step 5: Implement safe header filtering and bounded redirect execution**

Use this denylist:

```ts
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
```

Decode and size-check the request body before the first fetch. Execute upstream requests with `redirect: "manual"` and `AbortSignal.timeout(timeoutMs ?? PROXY_TIMEOUT_MS)`. For redirect statuses 301, 302, and 303 after a POST, change the next request to GET and drop its body/content headers; preserve the method for 307 and 308. Resolve relative `Location` values and call `validateTarget` before each next fetch.

Read upstream bodies through `response.body.getReader()` and stop as soon as accumulated bytes exceed `MAX_PROXY_RESPONSE_BYTES`; cancel the reader and raise `RESPONSE_TOO_LARGE`. Return headers through `headersToPairs()` and bodies through `encodeBody()`.

Map fetch aborts to `UPSTREAM_TIMEOUT`/504 and other network failures to `UPSTREAM_FAILURE`/502. Preserve existing `ProxyRelayError` instances.

- [ ] **Step 6: Add sanitized summary logging**

Log a single object rather than interpolated raw request data:

```ts
logger.info("service-proxy", {
  requestId,
  method,
  host: target.hostname,
  path: target.pathname,
  status,
  durationMs: Date.now() - startedAt,
  requestBytes,
  responseBytes,
});
```

On failure, log the same safe fields plus `errorCode`. Never include `target.search`, headers, bodies, or exception stacks from upstream network libraries.

When `config.debug` is true, log redirect lifecycle objects containing only `requestId`, `method`, `host`, `path`, `redirectStatus`, and `redirectNumber`. Do not add debug fields when it is false, and never include `Location` query parameters.

- [ ] **Step 7: Run relay tests and commit**

```bash
npm test -- tests/proxy/relay.test.ts
npm run check:tsc
git add src/proxy/relay.ts tests/proxy/relay.test.ts
git commit -m "feat: execute allowlisted proxy requests"
```

Expected: all relay tests PASS.

### Task 5: Expose the authenticated endpoint on the addon server

**Files:**
- Create: `src/endpoints/serviceProxy.ts`
- Modify: `server.ts`
- Create: `tests/proxy/serviceProxy.integration.test.ts`

- [ ] **Step 1: Write failing endpoint authentication tests**

Start a local `node:http` server around `createServiceProxyHandler()` and assert:

```ts
assert.equal((await fetch(endpoint, { method: "GET" })).status, 405);
assert.equal((await fetch(endpoint, { method: "POST", body: "{}" })).status, 401);
assert.equal((await fetch(endpoint, {
  method: "POST",
  headers: { authorization: "Bearer wrong", "content-type": "application/json" },
  body: "{}",
})).status, 401);
```

Assert missing server configuration returns 503, malformed JSON returns 400, and an endpoint envelope over 512 KiB returns 413. Parse each response and assert it has `{ error: { code, message, requestId } }` without echoing tokens or request bodies.

- [ ] **Step 2: Write the failing end-to-end relay test**

Start two local servers:

1. a fake upstream server implementing `/`, `/login`, `/search`, and `/detail`; and
2. the service relay endpoint.

Inject an upstream fetch adapter into the relay handler that receives validated `https://prehraj.to/...` URLs, rewrites only the origin to the fake upstream's loopback origin, and delegates to global fetch. This keeps production HTTPS/allowlist validation active while the test uses an isolated upstream.

Use `createServiceFetch()` pointed at the local relay. Prove this sequence:

```ts
const anonymous = await serviceFetch("https://prehraj.to/");
assert.deepEqual(anonymous.headers.getSetCookie(), ["anonymous=one; Path=/"]);

const form = new FormData();
form.set("email", "debug@example.test");
form.set("password", "not-a-real-secret");
const login = await serviceFetch("https://prehraj.to/login", {
  method: "POST",
  headers: { cookie: "anonymous=one" },
  body: form,
});
assert.deepEqual(login.headers.getSetCookie(), ["access_token=two; Path=/"]);

assert.match(await (await serviceFetch("https://prehraj.to/search", {
  headers: { cookie: "access_token=two" },
})).text(), /video--link/);
assert.match(await (await serviceFetch("https://prehraj.to/detail")).text(), /var sources/);
```

Record requests at the fake upstream and assert multipart content, cookies, methods, and paths arrived intact.

- [ ] **Step 3: Run endpoint tests and verify they fail**

Run `npm test -- tests/proxy/serviceProxy.integration.test.ts`.

Expected: FAIL because the endpoint factory does not exist.

- [ ] **Step 4: Implement bounded body reading and constant-time authentication**

Create `src/endpoints/serviceProxy.ts` exporting:

```ts
export type ServiceProxyHandlerDependencies = {
  env?: Environment;
  fetchImpl?: typeof fetch;
  logger?: ProxyLogger;
  createRequestId?: () => string;
};

export function createServiceProxyHandler(
  dependencies: ServiceProxyHandlerDependencies = {},
): (req: Request, res: Response) => Promise<void>;

export default createServiceProxyHandler();
```

Read at most `MAX_PROXY_ENVELOPE_BYTES` of raw endpoint input before parsing JSON. The larger envelope limit accounts for base64 expansion while the relay core separately enforces the 256 KiB decoded upstream-body limit. Authenticate `Authorization: Bearer <token>` with `node:crypto.timingSafeEqual` after comparing buffer lengths. Return:

- 503 `PROXY_DISABLED` when server configuration is absent;
- 405 `METHOD_NOT_ALLOWED` for non-POST endpoint requests;
- 401 `UNAUTHORIZED` for absent or incorrect tokens;
- 413 `REQUEST_TOO_LARGE` for oversized endpoint bodies;
- 400 `INVALID_REQUEST` for invalid JSON/envelopes;
- the status from `ProxyRelayError` for relay failures; and
- 500 `INTERNAL_ERROR` for unexpected failures.

Every JSON response includes `content-type: application/json; charset=utf-8` and `cache-control: no-store`. Every error uses a safe `ProxyErrorEnvelope`.

- [ ] **Step 5: Register the route in `server.ts`**

Import `serviceProxyHandler` and add this branch before `/media/`, `/test/`, `/clean/`, and SDK fallback:

```ts
if (req.url && req.url.split("?", 1)[0] === "/internal/service-proxy") {
  await serviceProxyHandler(req, res);
  return;
}
```

Await all custom async handlers while touching this routing block so thrown errors reach the existing wrapper.

Replace the existing double cast through `any` with a double cast through `unknown`:

```ts
SDK.serveHTTP(addonInterface, {
  port: process.env.PORT ? Number(process.env.PORT) : 52932,
}) as unknown as Promise<{ server: Express; url: string }>
```

- [ ] **Step 6: Run endpoint tests and all proxy tests**

```bash
npm test -- tests/proxy/serviceProxy.integration.test.ts
npm test
npm run check
```

Expected: all tests and checks PASS.

- [ ] **Step 7: Commit the endpoint**

```bash
git add src/endpoints/serviceProxy.ts server.ts tests/proxy/serviceProxy.integration.test.ts
git commit -m "feat: expose authenticated service proxy endpoint"
```

### Task 6: Route PrehrajTo control requests through the transport

**Files:**
- Modify: `src/service/prehrajto.ts`
- Modify: `src/endpoints/test.ts`
- Create: `tests/proxy/prehrajtoTransport.test.ts`

- [ ] **Step 1: Add a transport-injection seam and write a failing resolver test**

Change the resolver factory signature to accept a fetch dependency while keeping production callers unchanged:

```ts
export function getResolver(fetchImpl: typeof fetch = serviceFetch): Resolver
```

Create `tests/proxy/prehrajtoTransport.test.ts` with a fake fetch that returns, in order, anonymous cookies, authenticated cookies, search HTML, and detail HTML. Call `validateConfig`, `search`, and `resolve`, then assert every captured target is a PrehrajTo login/search/detail URL and every call went through the injected function. Assert the resolved `video` remains the upstream media URL and is never fetched by the resolver.

Use minimal HTML fixtures containing the selectors already parsed by the resolver:

```html
<a class="video--link" href="/video/1" title="Movie 2026">
  <span class="video__tag--size">1 GB</span>
  <span class="video__tag--time">01:30:00</span>
</a>
```

```html
<script>var sources = [{file: "https://media.example.test/movie.mp4"}]; var tracks = [];</script>
```

- [ ] **Step 2: Run the resolver transport test and verify it fails**

Run `npm test -- tests/proxy/prehrajtoTransport.test.ts`.

Expected: FAIL because `getResolver` does not accept the transport and direct global fetch is still used.

- [ ] **Step 3: Replace only control-plane fetch calls**

Import `serviceFetch`, accept the injected `fetchImpl`, and replace the four direct calls in `login`, `loginAnonymous`, `getSearchResults`, and `getResultStreamUrls`. Thread the dependency through these internal functions without changing their request URLs, methods, form fields, headers, parsing, cache lifetime, or return types.

Do not change the final media URL and do not wrap the media-range fetch in `src/endpoints/test.ts`; that range request intentionally verifies client-visible media separately from control-plane proxying.

- [ ] **Step 4: Remove hardcoded debug credentials**

In `src/endpoints/test.ts`, replace the literal account with:

```ts
const userName = process.env.PREHRAJTO_DEBUG_USERNAME;
const password = process.env.PREHRAJTO_DEBUG_PASSWORD;
if (!userName || !password) {
  res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("PREHRAJTO_DEBUG_USERNAME and PREHRAJTO_DEBUG_PASSWORD are required" + NL);
  return;
}
const addonConfig = {
  prehrajtoUsername: userName,
  prehrajtoPassword: password,
};
```

Ensure debug output does not serialize cached request headers or cookies. Replace the resolver's `debug()` payload with safe booleans/timestamps such as `{ cached: Boolean(cache), cacheCreated: cache?.created ?? null, authenticated: "headers" in await login(...) }`.

Also replace `catch (e: any)` in the debug endpoint with `catch (e: unknown)` so the existing lint failure is removed without weakening the lint rule.

- [ ] **Step 5: Run resolver and full tests**

```bash
npm test -- tests/proxy/prehrajtoTransport.test.ts
npm test
npm run check
```

Expected: all tests and checks PASS; repository search finds no committed debug account:

```bash
rg -n "canifi7158|matmayer" . --glob '!docs/superpowers/**'
```

Expected: no matches.

- [ ] **Step 6: Commit the resolver migration and credential cleanup**

```bash
git add src/service/prehrajto.ts src/endpoints/test.ts tests/proxy/prehrajtoTransport.test.ts
git commit -m "feat: proxy PrehrajTo control requests"
```

### Task 7: Document secure deployment and local debugging

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Protect local secrets**

Append to `.gitignore`:

```gitignore
.env
.env.*
!.env.example
```

Create `.env.example` containing names and safe explanatory values only:

```dotenv
# Deployed relay endpoint
SERVICE_PROXY_TOKEN=replace-with-a-long-random-secret
SERVICE_PROXY_ALLOWED_HOSTS=prehraj.to
SERVICE_PROXY_DEBUG=false

# Local client; SERVICE_PROXY_CLIENT_TOKEN must equal deployed SERVICE_PROXY_TOKEN
SERVICE_PROXY_URL=https://your-deployed-addon.example/internal/service-proxy
SERVICE_PROXY_CLIENT_TOKEN=replace-with-the-same-long-random-secret

# Optional /test endpoint credentials; never commit real values
PREHRAJTO_DEBUG_USERNAME=
PREHRAJTO_DEBUG_PASSWORD=
```

- [ ] **Step 2: Write operational documentation**

Create `README.md` with:

- project purpose and Node 24 prerequisite;
- `npm install`, `npm start`, `npm test`, and `npm run check` commands;
- deployed server variables and local client variables in separate sections;
- a secret-generation example using `openssl rand -hex 32`;
- a warning that the client and server token values match but their variable names differ;
- direct mode behavior when client variables are absent;
- the default exact hostname allowlist and comma-separated extension mechanism;
- a statement that only GET/HEAD/POST buffered control requests are supported;
- request/response limits, timeout, and redirect cap;
- sanitized logging behavior and `SERVICE_PROXY_DEBUG` usage;
- explicit confirmation that media URLs and downloads bypass the relay;
- troubleshooting for 401, 403, 413, 502, 503, and 504 responses; and
- manual verification commands for direct and proxy modes.

Use this local proxy-mode launch example:

```bash
SERVICE_PROXY_URL="https://your-deployed-addon.example/internal/service-proxy" \
SERVICE_PROXY_CLIENT_TOKEN="$(security find-generic-password -w -s stremio-service-proxy)" \
npm start
```

Do not suggest putting real tokens on a command line in shared shells or committing them to `.env.example`.

- [ ] **Step 3: Verify documentation and secret hygiene**

```bash
git diff --check
git status --short
rg -n "SERVICE_PROXY_(URL|CLIENT_TOKEN|TOKEN|ALLOWED_HOSTS|DEBUG)" README.md .env.example src tests
git grep -n "canifi7158\|matmayer"
```

Expected: formatting check passes, all variables are documented and used consistently, and the credential search has no matches.

- [ ] **Step 4: Commit documentation**

```bash
git add .gitignore .env.example README.md
git commit -m "docs: explain service proxy debugging"
```

### Task 8: Final verification and manual deployment smoke test

**Files:**
- No source changes expected
- Update tests or documentation only if verification exposes a defect

- [ ] **Step 1: Run the complete local verification suite**

```bash
npm clean-install
npm test
npm run check
git diff --check
git status --short
```

Expected: dependency install succeeds, every test passes, TypeScript and ESLint pass, there is no whitespace error, and the worktree is clean.

- [ ] **Step 2: Verify direct mode locally**

Start without `SERVICE_PROXY_URL` or `SERVICE_PROXY_CLIENT_TOKEN`:

```bash
npm start
```

Exercise the existing test or addon stream endpoint with debug credentials supplied only through the environment. Expected: relay logs are absent and resolver control requests leave the local machine directly.

- [ ] **Step 3: Deploy the relay configuration**

Configure the deployed service with:

```dotenv
SERVICE_PROXY_TOKEN=<generated-secret>
SERVICE_PROXY_ALLOWED_HOSTS=prehraj.to
SERVICE_PROXY_DEBUG=true
```

Restart/redeploy the existing addon service. Expected: normal deployed addon behavior remains direct because `SERVICE_PROXY_URL` is absent, while `/internal/service-proxy` is available only with the bearer token.

- [ ] **Step 4: Verify local-through-deployed mode**

Start the local addon with:

```dotenv
SERVICE_PROXY_URL=https://<deployment>/internal/service-proxy
SERVICE_PROXY_CLIENT_TOKEN=<same-generated-secret>
PREHRAJTO_DEBUG_USERNAME=<local-secret>
PREHRAJTO_DEBUG_PASSWORD=<local-secret>
```

Exercise login, search, and detail resolution. Expected deployed logs: sanitized entries for PrehrajTo GET/POST requests with request IDs, statuses, durations, and byte counts. Expected local behavior: the same parsed results as direct mode. Expected media behavior: the final media host is contacted by Stremio or the explicit test range request, not by `/internal/service-proxy`.

- [ ] **Step 5: Verify rejection paths against the deployed endpoint**

Send an unauthenticated request and an authenticated request targeting a non-allowlisted host. Expected: 401 and 403 respectively, with structured request IDs and no outbound request to the forbidden destination.

- [ ] **Step 6: Disable verbose diagnostics after debugging**

Set `SERVICE_PROXY_DEBUG=false` on the deployment and redeploy. Keep normal sanitized summary logs enabled.

- [ ] **Step 7: Record the final verification result**

If no fixes were required, no commit is needed. If verification required a correction, add a focused regression test, make the smallest fix, rerun Steps 1–6, and commit only those related files with a message describing the corrected behavior.
