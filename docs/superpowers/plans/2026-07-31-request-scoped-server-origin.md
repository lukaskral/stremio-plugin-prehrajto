# Request-Scoped Server Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate every CzStreams `/media/...` callback URL from the current request's public origin, including trusted reverse-proxy scheme, hostname, and port information.

**Architecture:** Add a focused `serverOrigin.ts` boundary that validates direct and forwarded request metadata, stores the normalized origin in `AsyncLocalStorage`, and wraps the existing HTTP server listeners. Keep `getTopItems()` unchanged: `getServerUrl()` reads the active origin, while `server.ts` installs the context wrapper after its existing custom-route wrapper. Forwarded headers remain disabled unless the immediate peer matches the configured `TRUST_PROXY` expression.

**Tech Stack:** Node.js 24, TypeScript, Node `AsyncLocalStorage`, `proxy-addr`, Stremio Addon SDK, Express-compatible HTTP server, Vitest, Home Assistant add-on YAML.

---

## File structure

- Create `czstreams/src/serverOrigin.ts`: own trusted-proxy compilation, request-origin validation, request-scoped storage, and HTTP-listener wrapping.
- Create `czstreams/tests/serverOrigin.test.ts`: cover origin parsing, trust decisions, invalid input, async propagation, and concurrency isolation.
- Create `czstreams/tests/serverUrl.integration.test.ts`: exercise `getServerUrl()` through a real local Node HTTP server wrapped with the production origin context.
- Modify `czstreams/src/utils/getServerUrl.ts`: return the current request's normalized origin instead of the removed hosted URL.
- Modify `czstreams/server.ts`: compile proxy trust at startup and install request-origin context around the completed request router.
- Modify `czstreams/package.json` and `czstreams/package-lock.json`: declare `proxy-addr` and its TypeScript definitions directly, then advance the package version.
- Modify `czstreams/src/homeAssistantConfig.ts`: map optional Home Assistant `trusted_proxies` configuration to `TRUST_PROXY`.
- Modify `czstreams/tests/homeAssistantConfig.test.ts`: verify proxy configuration mapping.
- Modify `czstreams/config.yaml` and `czstreams/tests/homeAssistantAddon.test.ts`: expose optional trusted proxies and advance the add-on version in lockstep.
- Modify `czstreams/.env.example`, `czstreams/README.md`, `czstreams/DOCS.md`, and `czstreams/CHANGELOG.md`: document local and Home Assistant reverse-proxy setup.

### Task 1: Declare the trusted-proxy dependency

**Files:**
- Modify: `czstreams/package.json`
- Modify: `czstreams/package-lock.json`

- [ ] **Step 1: Install the runtime and type dependencies**

Run from `czstreams/`:

```bash
npm install proxy-addr@^2.0.7
npm install --save-dev @types/proxy-addr@^2.0.3
```

Expected: both commands exit `0`; `package-lock.json` records `proxy-addr` as a direct production dependency and `@types/proxy-addr` as a direct development dependency.

- [ ] **Step 2: Verify the dependency classification**

Run:

```bash
node -e 'const p=require("./package.json"); if (!p.dependencies["proxy-addr"] || !p.devDependencies["@types/proxy-addr"]) process.exit(1)'
npm ls proxy-addr @types/proxy-addr --depth=0
```

Expected: both commands exit `0` and list one direct installation of each package.

- [ ] **Step 3: Commit the dependency declaration**

```bash
git add czstreams/package.json czstreams/package-lock.json
git commit -m "build: declare proxy address dependency"
```

### Task 2: Derive and isolate request origins

**Files:**
- Create: `czstreams/src/serverOrigin.ts`
- Create: `czstreams/tests/serverOrigin.test.ts`

- [ ] **Step 1: Write the failing origin and context tests**

Create `czstreams/tests/serverOrigin.test.ts`:

```ts
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
    [fakeRequest({ host: "user@example.test" }), "Request origin must not contain credentials"],
    [fakeRequest({ host: "example.test/path" }), "Request origin must not contain a path, query, or fragment"],
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
      getRequestOrigin(request, createTrustProxy("loopback"))
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
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run from `czstreams/`:

```bash
npx vitest run tests/serverOrigin.test.ts
```

Expected: FAIL because `../src/serverOrigin.ts` does not exist.

- [ ] **Step 3: Implement trusted origin derivation and request context**

Create `czstreams/src/serverOrigin.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { type IncomingMessage } from "node:http";

import proxyaddr from "proxy-addr";

export type TrustProxy = ReturnType<typeof proxyaddr.compile>;

const serverOrigin = new AsyncLocalStorage<string>();

export function createTrustProxy(value: string | undefined): TrustProxy | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries && entries.length > 0 ? proxyaddr.compile(entries) : undefined;
}

function readSingleHeader(
  request: IncomingMessage,
  name: "host" | "x-forwarded-host" | "x-forwarded-proto",
): string | undefined {
  const value = request.headers[name];
  const displayName = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("-");

  if (value === undefined) return undefined;
  if (Array.isArray(value) || value.includes(",")) {
    throw new Error(`${displayName} must contain exactly one value`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function connectionProtocol(request: IncomingMessage): "http" | "https" {
  const socket = request.socket as typeof request.socket & {
    encrypted?: boolean;
  };
  return socket.encrypted === true ? "https" : "http";
}

export function getRequestOrigin(
  request: IncomingMessage,
  trustProxy?: TrustProxy,
): string {
  const remoteAddress = request.socket.remoteAddress;
  const isTrustedProxy =
    remoteAddress !== undefined && trustProxy?.(remoteAddress, 0) === true;
  const forwardedHost = isTrustedProxy
    ? readSingleHeader(request, "x-forwarded-host")
    : undefined;
  const forwardedProto = isTrustedProxy
    ? readSingleHeader(request, "x-forwarded-proto")
    : undefined;
  const host = forwardedHost ?? readSingleHeader(request, "host");
  const protocol = (forwardedProto ?? connectionProtocol(request)).toLowerCase();

  if (!host) throw new Error("Request Host header is required");
  if (protocol !== "http" && protocol !== "https") {
    throw new Error("Request protocol must be http or https");
  }

  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    throw new Error("Request origin is invalid");
  }

  if (origin.username || origin.password) {
    throw new Error("Request origin must not contain credentials");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Request origin must not contain a path, query, or fragment");
  }

  return origin.origin;
}

export function runWithServerOrigin<T>(origin: string, callback: () => T): T {
  return serverOrigin.run(origin, callback);
}

export function getServerOrigin(): string {
  const origin = serverOrigin.getStore();
  if (!origin) {
    throw new Error("Server origin is unavailable outside an HTTP request");
  }
  return origin;
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

```bash
npx vitest run tests/serverOrigin.test.ts
```

Expected: PASS for all direct, forwarded, validation, propagation, and isolation cases.

- [ ] **Step 5: Run static checks for the new module**

Run:

```bash
npm run check:tsc
npm run check:lint
```

Expected: both commands exit `0`. If Prettier-compatible wrapping is needed, make only mechanical formatting changes to the two new files and rerun both commands.

- [ ] **Step 6: Commit origin derivation and isolation**

```bash
git add czstreams/src/serverOrigin.ts czstreams/tests/serverOrigin.test.ts
git commit -m "feat: derive request-scoped server origins"
```

### Task 3: Wrap the HTTP server and replace the hard-coded URL

**Files:**
- Modify: `czstreams/src/serverOrigin.ts`
- Modify: `czstreams/src/utils/getServerUrl.ts`
- Modify: `czstreams/server.ts:3-60`
- Create: `czstreams/tests/serverUrl.integration.test.ts`

- [ ] **Step 1: Write a failing real-server integration test**

Create `czstreams/tests/serverUrl.integration.test.ts`:

```ts
import {
  createServer,
  type OutgoingHttpHeaders,
  request as httpRequest,
  type RequestListener,
  type Server,
} from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import { getTopItems, type Resolver } from "../src/getTopItems.ts";
import { type Meta } from "../src/meta.ts";
import {
  createTrustProxy,
  installServerOriginContext,
} from "../src/serverOrigin.ts";
import { getServerUrl } from "../src/utils/getServerUrl.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        }),
    ),
  );
});

async function startOriginServer(
  trustedProxies?: string,
  listener: RequestListener = (_request, response) => {
    response.end(getServerUrl());
  },
  logError: (message: string, error: unknown) => void = () => undefined,
): Promise<Server> {
  const server = createServer(listener);
  installServerOriginContext(
    server,
    createTrustProxy(trustedProxies),
    logError,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server;
}

function get(
  server: Server,
  headers: OutgoingHttpHeaders,
): Promise<{ body: string; status: number | undefined }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode,
          })
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("request-scoped server URL", () => {
  test("returns the direct request origin", async () => {
    const server = await startOriginServer();

    await expect(
      get(server, { host: "homeassistant.local:52932" }),
    ).resolves.toEqual({
      body: "http://homeassistant.local:52932",
      status: 200,
    });
  });

  test("returns the public origin supplied by a trusted proxy", async () => {
    const server = await startOriginServer("loopback");

    await expect(
      get(server, {
        host: "czstreams:52932",
        "x-forwarded-host": "media.example.test",
        "x-forwarded-proto": "https",
      }),
    ).resolves.toEqual({
      body: "https://media.example.test",
      status: 200,
    });
  });

  test("rejects an invalid effective origin before invoking the listener", async () => {
    const server = await startOriginServer();

    await expect(get(server, { host: "user@example.test" })).resolves.toEqual({
      body: "Invalid request origin\r\n\r\n",
      status: 400,
    });
  });

  test("uses the public origin in a generated media callback URL", async () => {
    const meta = {
      names: { en: "Example Movie" },
      released: "2026",
      runtime: "90",
    } as Meta;
    const resolver: Resolver = {
      resolverName: "fake resolver",
      init: () => true,
      getConfigFields: () => [],
      validateConfig: async () => true,
      search: async () => [{
        resolverId: "item/123",
        title: "Example Movie 2026",
        detailPageUrl: "https://storage.example/item/123",
        duration: 5400,
        size: 3_000_000_000,
      }],
      resolve: async () => ({ video: "https://storage.example/video" }),
    };
    const server = await startOriginServer(
      "loopback",
      (_request, response) => {
        void getTopItems(meta, [resolver], {}).then(
          ([item]) => response.end(item.video),
          (error: unknown) => {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : String(error));
          },
        );
      },
    );

    await expect(
      get(server, {
        host: "czstreams:52932",
        "x-forwarded-host": "media.example.test",
        "x-forwarded-proto": "https",
      }),
    ).resolves.toEqual({
      body: "https://media.example.test/media/fake%20resolver/item%2F123?config=%7B%7D",
      status: 200,
    });
  });
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run from `czstreams/`:

```bash
npx vitest run tests/serverUrl.integration.test.ts
```

Expected: FAIL because `installServerOriginContext` is not exported yet; after adding only the export signature, the URL assertions still fail because `getServerUrl()` returns the old `baby-beamup.club` hostname.

- [ ] **Step 3: Add the reusable HTTP-listener wrapper**

Append to `czstreams/src/serverOrigin.ts`, and add `Server` and `RequestListener` to its existing `node:http` type import:

```ts
import {
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";
```

```ts
type LogOriginError = (message: string, error: unknown) => void;

export function installServerOriginContext(
  server: Server,
  trustProxy?: TrustProxy,
  logError: LogOriginError = console.error,
): void {
  const originalListeners = server.listeners("request") as RequestListener[];
  server.removeAllListeners("request");

  server.on("request", (request, response) => {
    let origin: string;
    try {
      origin = getRequestOrigin(request, trustProxy);
    } catch (error) {
      logError("Invalid request origin:", error);
      response.writeHead(400, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Invalid request origin\r\n\r\n");
      return;
    }

    runWithServerOrigin(origin, () => {
      for (const listener of originalListeners) {
        listener.call(server, request, response);
      }
    });
  });
}
```

- [ ] **Step 4: Make `getServerUrl()` read the active request origin**

Replace `czstreams/src/utils/getServerUrl.ts` with:

```ts
import { getServerOrigin } from "../serverOrigin.ts";

export function getServerUrl() {
  return getServerOrigin();
}
```

- [ ] **Step 5: Install origin context around the completed CzStreams request router**

Add this import to `czstreams/server.ts`:

```ts
import {
  createTrustProxy,
  installServerOriginContext,
} from "./src/serverOrigin.ts";
```

At the start of the `runWithStartupHandling` callback, before `serveHTTP`, compile configuration so invalid proxy ranges fail startup:

```ts
  const trustProxy = createTrustProxy(process.env.TRUST_PROXY);
```

After the existing `server.on("request", ...)` custom-route wrapper has been installed, but before the callback returns, add:

```ts
  installServerOriginContext(server, trustProxy);
```

The order is significant: the origin wrapper must capture the completed custom-route listener, which in turn already captures the original Stremio SDK listener.

- [ ] **Step 6: Run the server-origin and integration tests**

Run:

```bash
npx vitest run tests/serverOrigin.test.ts tests/serverUrl.integration.test.ts
```

Expected: PASS. The real HTTP server returns the direct origin and the trusted forwarded origin rather than the hard-coded hosted URL.

- [ ] **Step 7: Verify startup and URL construction remain valid**

Run:

```bash
npx vitest run tests/startup.test.ts
npm run check:tsc
npm run check:lint
```

Expected: all commands exit `0`; `server.ts` type-checks with the context wrapper installed after the current router.

- [ ] **Step 8: Commit the server integration**

```bash
git add czstreams/src/serverOrigin.ts czstreams/src/utils/getServerUrl.ts czstreams/server.ts czstreams/tests/serverUrl.integration.test.ts
git commit -m "fix: generate media URLs from request origin"
```

### Task 4: Expose trusted proxies through Home Assistant

**Files:**
- Modify: `czstreams/src/homeAssistantConfig.ts:33-48`
- Modify: `czstreams/tests/homeAssistantConfig.test.ts:9-81`
- Modify: `czstreams/config.yaml:1-24`
- Modify: `czstreams/tests/homeAssistantAddon.test.ts:24-51`
- Modify: `czstreams/package.json`
- Modify: `czstreams/package-lock.json`

- [ ] **Step 1: Add failing Home Assistant mapping tests**

Add this test inside the `Home Assistant configuration` suite in `czstreams/tests/homeAssistantConfig.test.ts`:

```ts
  test("maps trusted proxy ranges without changing their value", () => {
    expect(
      getHomeAssistantEnvironment({
        trusted_proxies: "172.30.32.0/23, 192.168.1.10",
      }),
    ).toEqual({
      TRUST_PROXY: "172.30.32.0/23, 192.168.1.10",
    });
  });
```

Extend the existing optional-values table with:

```ts
    [{ trusted_proxies: "" }, {}],
    [{ trusted_proxies: 42 }, {}],
```

In `czstreams/tests/homeAssistantAddon.test.ts`, rename the metadata test to `defines optional CzStreams settings`, change the expected version to `0.1.13`, and extend the expected schema:

```ts
      version: "0.1.13",
```

```ts
      schema: {
        prehrajto_debug_username: "str?",
        prehrajto_debug_password: "password?",
        trusted_proxies: "str?",
      },
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run from `czstreams/`:

```bash
npx vitest run tests/homeAssistantConfig.test.ts tests/homeAssistantAddon.test.ts
```

Expected: FAIL because proxy options are not mapped or declared and both package surfaces still report `0.1.12`.

- [ ] **Step 3: Map the optional Home Assistant value**

In `getHomeAssistantEnvironment()` in `czstreams/src/homeAssistantConfig.ts`, read the new option beside the credential fields:

```ts
  const trustedProxies = options.trusted_proxies;
```

Add this mapping after the password mapping:

```ts
  if (typeof trustedProxies === "string" && trustedProxies.length > 0) {
    environment.TRUST_PROXY = trustedProxies;
  }
```

- [ ] **Step 4: Add the optional Home Assistant schema field**

Update the end of `czstreams/config.yaml` to:

```yaml
options: {}

schema:
  prehrajto_debug_username: str?
  prehrajto_debug_password: password?
  trusted_proxies: str?
```

- [ ] **Step 5: Advance package and add-on versions together**

Run from `czstreams/`:

```bash
npm version 0.1.13 --no-git-tag-version
```

Then change the `version` field in `czstreams/config.yaml` to:

```yaml
version: "0.1.13"
```

Expected: `package.json`, the root package entry in `package-lock.json`, and `config.yaml` all report `0.1.13`; no Git tag or commit is created by the command.

- [ ] **Step 6: Run the focused tests to verify they pass**

Run:

```bash
npx vitest run tests/homeAssistantConfig.test.ts tests/homeAssistantAddon.test.ts
```

Expected: PASS for configuration mapping, optional values, matching versions, and schema metadata.

- [ ] **Step 7: Commit Home Assistant configuration**

```bash
git add czstreams/src/homeAssistantConfig.ts czstreams/tests/homeAssistantConfig.test.ts czstreams/config.yaml czstreams/tests/homeAssistantAddon.test.ts czstreams/package.json czstreams/package-lock.json
git commit -m "feat: configure trusted reverse proxies"
```

### Task 5: Document direct and reverse-proxy operation

**Files:**
- Modify: `czstreams/tests/homeAssistantAddon.test.ts`
- Modify: `czstreams/.env.example`
- Modify: `czstreams/README.md`
- Modify: `czstreams/DOCS.md`
- Modify: `czstreams/CHANGELOG.md`

- [ ] **Step 1: Add a failing documentation contract test**

Add this test to `czstreams/tests/homeAssistantAddon.test.ts`:

```ts
  test("documents trusted reverse-proxy configuration", () => {
    const docs = readFileSync(resolve(addonRoot, "DOCS.md"), "utf8");
    const envExample = readFileSync(resolve(addonRoot, ".env.example"), "utf8");

    expect(docs).toContain("trusted_proxies");
    expect(docs).toContain("X-Forwarded-Proto");
    expect(docs).toContain("X-Forwarded-Host");
    expect(envExample).toContain("TRUST_PROXY=");
  });
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run from `czstreams/`:

```bash
npx vitest run tests/homeAssistantAddon.test.ts
```

Expected: FAIL because neither the add-on documentation nor `.env.example` mentions trusted proxy configuration.

- [ ] **Step 3: Document the local environment variable**

Add this block immediately after `PORT` in `czstreams/.env.example`:

```dotenv

# Comma-separated proxy IPs/CIDRs allowed to supply public origin headers.
# Leave empty for direct access. Keep this narrower than the client network.
TRUST_PROXY=
```

Add a `Request origin and reverse proxies` subsection after the development commands in `czstreams/README.md` with this content:

````markdown
## Request origin and reverse proxies

Media callback URLs use the same public origin that requested the add-on. Direct
HTTP access needs no configuration. A reverse-proxy deployment must set
`TRUST_PROXY` to the proxy's IP address or CIDR range and must replace
client-supplied `X-Forwarded-Proto` and `X-Forwarded-Host` headers with the
public request values.

```dotenv
TRUST_PROXY=172.30.32.0/23
```

Forwarded headers from peers outside the configured range are ignored. Use the
narrowest stable address or network from which the proxy connects.
````

- [ ] **Step 4: Document Home Assistant reverse-proxy setup**

Add this section before `Troubleshooting` in `czstreams/DOCS.md`:

````markdown
## Reverse proxy

Media URLs must retain the public scheme and hostname used by Stremio. When a
reverse proxy terminates HTTPS, set the optional `trusted_proxies` add-on field
to the proxy's source IP address or CIDR range. Do not enter the addresses of
Stremio clients.

Configure the proxy to replace incoming forwarding headers and send the public
values to CzStreams. For nginx, the relevant directives are:

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

Forwarded headers are ignored when `trusted_proxies` is empty or the connection
does not come from a matching proxy address. Restart the add-on after changing
the setting.
````

- [ ] **Step 5: Record the release behavior**

Prepend this release section after the title in `czstreams/CHANGELOG.md`:

```markdown
## 0.1.13

- Generate media callback URLs from each request's direct or trusted forwarded
  public origin instead of a hard-coded hosted deployment.
- Add optional Home Assistant trusted-proxy configuration for HTTPS reverse
  proxies.

```

- [ ] **Step 6: Run the documentation contract and static checks**

Run:

```bash
npx vitest run tests/homeAssistantAddon.test.ts
npm run check:lint
git diff --check
```

Expected: all commands exit `0`; the documentation test finds the setting and both forwarded header names.

- [ ] **Step 7: Commit documentation and release notes**

```bash
git add czstreams/tests/homeAssistantAddon.test.ts czstreams/.env.example czstreams/README.md czstreams/DOCS.md czstreams/CHANGELOG.md
git commit -m "docs: explain reverse proxy origin handling"
```

### Task 6: Complete verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Prove the hosted URL is gone from runtime code**

Run from the repository root:

```bash
rg -n "03df1f38e4c6-stremio-plugin-prehrajto|baby-beamup\.club" czstreams --glob '!CHANGELOG.md'
```

Expected: no matches and exit status `1`, indicating the obsolete deployment is absent from runtime, tests, and current documentation.

- [ ] **Step 2: Run the complete project check**

Run from `czstreams/`:

```bash
npm run check
```

Expected: TypeScript, ESLint, and the complete Vitest suite all pass. The suite includes the local real-server origin integration test and performs no external network calls.

- [ ] **Step 3: Verify production dependency installation**

Run:

```bash
npm ls proxy-addr --omit=dev --depth=0
```

Expected: exit `0` with `proxy-addr@2.0.7` shown as a direct production dependency.

- [ ] **Step 4: Inspect final repository state**

Run from the repository root:

```bash
git status --short
git log -5 --oneline
```

Expected: no uncommitted implementation changes; the recent commits correspond to dependency declaration, request-origin derivation, server integration, Home Assistant configuration, and documentation.
