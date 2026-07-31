import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Request, Response } from "express";
import { expect, it } from "vitest";

import { createServiceProxyHandler } from "../../src/endpoints/serviceProxy.ts";
import type { ProxyErrorEnvelope } from "../../src/proxy/protocol.ts";
import { createServiceFetch } from "../../src/proxy/serviceFetch.ts";

const silentLogger = {
  info: (): void => undefined,
  error: (): void => undefined,
};

async function startServer(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function nodeListener(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return (req: IncomingMessage, res: ServerResponse) => {
    void handler(req as unknown as Request, res as unknown as Response);
  };
}

it("missing server token disables the endpoint", async () => {
  const handler = createServiceProxyHandler({
    env: {},
    logger: silentLogger,
    createRequestId: () => "request-disabled",
  });
  const relay = await startServer(nodeListener(handler));
  try {
    const response = await fetch(relay.url, { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    const body = (await response.json()) as ProxyErrorEnvelope;
    expect(body.error.code).toBe("PROXY_DISABLED");
  } finally {
    await relay.close();
  }
});

it("rejects non-POST endpoint requests", async () => {
  const handler = createServiceProxyHandler({
    env: { SERVICE_PROXY_TOKEN: "secret" },
    logger: silentLogger,
    createRequestId: () => "request-auth",
  });
  const relay = await startServer(nodeListener(handler));
  try {
    expect((await fetch(relay.url)).status).toBe(405);
  } finally {
    await relay.close();
  }
});

it("rejects missing and incorrect bearer tokens", async () => {
  const handler = createServiceProxyHandler({
    env: { SERVICE_PROXY_TOKEN: "secret" },
    logger: silentLogger,
    createRequestId: () => "request-auth",
  });
  const relay = await startServer(nodeListener(handler));
  try {
    expect(
      (await fetch(relay.url, { method: "POST", body: "{}" })).status,
    ).toBe(401);
    expect(
      (
        await fetch(relay.url, {
          method: "POST",
          headers: {
            authorization: "Bearer wrong",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  } finally {
    await relay.close();
  }
});

it("rejects malformed and oversized JSON safely", async () => {
  const handler = createServiceProxyHandler({
    env: { SERVICE_PROXY_TOKEN: "secret" },
    logger: silentLogger,
    createRequestId: () => "request-auth",
  });
  const relay = await startServer(nodeListener(handler));
  try {
    const malformed = await fetch(relay.url, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "not-json",
    });
    expect(malformed.status).toBe(400);
    const malformedBody = (await malformed.json()) as ProxyErrorEnvelope;
    expect(malformedBody.error.code).toBe("INVALID_REQUEST");

    const oversized = await fetch(relay.url, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "x".repeat(512 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);
    const body = (await oversized.json()) as ProxyErrorEnvelope;
    expect(body.error.code).toBe("REQUEST_TOO_LARGE");
    expect(JSON.stringify(body)).not.toContain("Bearer secret");
  } finally {
    await relay.close();
  }
});

it("client, relay endpoint, and fake upstream preserve login and HTML traffic", async () => {
  const requests: Array<{
    path: string;
    method: string;
    cookie?: string;
    contentType?: string;
    body: string;
  }> = [];
  const upstream = await startServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://upstream.test").pathname;
      requests.push({
        path,
        method: req.method ?? "GET",
        cookie: req.headers.cookie,
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString(),
      });
      if (path === "/") {
        res.setHeader("set-cookie", "anonymous=one; Path=/");
        res.end("home");
        return;
      }
      if (path === "/login") {
        res.setHeader("set-cookie", "access_token=two; Path=/");
        res.end("logged-in");
        return;
      }
      if (path === "/search") {
        res.end('<a class="video--link" href="/detail">Movie</a>');
        return;
      }
      if (path === "/detail") {
        res.end('<script>var sources = [{file: "https://media.example/movie.mp4"}];</script>');
        return;
      }
      res.statusCode = 404;
      res.end("missing");
    });
  });

  const upstreamFetch = (async (input, init) => {
    const original = new URL(String(input));
    const rewritten = new URL(original.pathname + original.search, upstream.url);
    return fetch(rewritten, init);
  }) satisfies typeof fetch;
  const handler = createServiceProxyHandler({
    env: { SERVICE_PROXY_TOKEN: "secret" },
    fetchImpl: upstreamFetch,
    logger: silentLogger,
    createRequestId: () => "request-integration",
  });
  const relay = await startServer(nodeListener(handler));
  try {
    const serviceFetch = createServiceFetch({
      env: {
        SERVICE_PROXY_URL: relay.url,
        SERVICE_PROXY_CLIENT_TOKEN: "secret",
      },
    });

    const anonymous = await serviceFetch("https://prehraj.to/");
    expect(anonymous.headers.getSetCookie()).toEqual([
      "anonymous=one; Path=/",
    ]);

    const form = new FormData();
    form.set("email", "debug@example.test");
    form.set("password", "not-a-real-secret");
    const login = await serviceFetch("https://prehraj.to/login", {
      method: "POST",
      headers: { cookie: "anonymous=one" },
      body: form,
    });
    expect(login.headers.getSetCookie()).toEqual([
      "access_token=two; Path=/",
    ]);
    expect(
      await (
        await serviceFetch("https://prehraj.to/search", {
          headers: { cookie: "access_token=two" },
        })
      ).text(),
    ).toMatch(/video--link/);
    expect(await (await serviceFetch("https://prehraj.to/detail")).text()).toMatch(
      /var sources/,
    );

    expect(requests.map(({ path, method }) => [path, method])).toEqual([
      ["/", "GET"],
      ["/login", "POST"],
      ["/search", "GET"],
      ["/detail", "GET"],
    ]);
    expect(requests[1].cookie).toBe("anonymous=one");
    expect(requests[1].contentType ?? "").toMatch(
      /multipart\/form-data; boundary=/,
    );
    expect(requests[1].body).toMatch(/debug@example\.test/);
    expect(requests[2].cookie).toBe("access_token=two");
  } finally {
    await relay.close();
    await upstream.close();
  }
});
