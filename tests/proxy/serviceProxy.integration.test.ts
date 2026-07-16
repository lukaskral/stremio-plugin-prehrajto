import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { Request, Response } from "express";

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

test("endpoint enforces configuration, method, authentication, and body limits", async (t) => {
  await t.test("missing server token disables the endpoint", async () => {
    const handler = createServiceProxyHandler({
      env: {},
      logger: silentLogger,
      createRequestId: () => "request-disabled",
    });
    const relay = await startServer(nodeListener(handler));
    t.after(relay.close);
    const response = await fetch(relay.url, { method: "POST", body: "{}" });
    assert.equal(response.status, 503);
    const body = (await response.json()) as ProxyErrorEnvelope;
    assert.equal(body.error.code, "PROXY_DISABLED");
  });

  const handler = createServiceProxyHandler({
    env: { SERVICE_PROXY_TOKEN: "secret" },
    logger: silentLogger,
    createRequestId: () => "request-auth",
  });
  const relay = await startServer(nodeListener(handler));
  t.after(relay.close);

  await t.test("rejects non-POST endpoint requests", async () => {
    assert.equal((await fetch(relay.url)).status, 405);
  });

  await t.test("rejects missing and incorrect bearer tokens", async () => {
    assert.equal(
      (await fetch(relay.url, { method: "POST", body: "{}" })).status,
      401,
    );
    assert.equal(
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
      401,
    );
  });

  await t.test("rejects malformed and oversized JSON safely", async () => {
    const malformed = await fetch(relay.url, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "not-json",
    });
    assert.equal(malformed.status, 400);
    const malformedBody = (await malformed.json()) as ProxyErrorEnvelope;
    assert.equal(malformedBody.error.code, "INVALID_REQUEST");

    const oversized = await fetch(relay.url, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "x".repeat(512 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    const body = (await oversized.json()) as ProxyErrorEnvelope;
    assert.equal(body.error.code, "REQUEST_TOO_LARGE");
    assert.equal(JSON.stringify(body).includes("Bearer secret"), false);
  });
});

test("client, relay endpoint, and fake upstream preserve login and HTML traffic", async (t) => {
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
  t.after(upstream.close);

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
  t.after(relay.close);
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: relay.url,
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
  });

  const anonymous = await serviceFetch("https://prehraj.to/");
  assert.deepEqual(anonymous.headers.getSetCookie(), [
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
  assert.deepEqual(login.headers.getSetCookie(), [
    "access_token=two; Path=/",
  ]);
  assert.match(
    await (
      await serviceFetch("https://prehraj.to/search", {
        headers: { cookie: "access_token=two" },
      })
    ).text(),
    /video--link/,
  );
  assert.match(
    await (await serviceFetch("https://prehraj.to/detail")).text(),
    /var sources/,
  );

  assert.deepEqual(
    requests.map(({ path, method }) => [path, method]),
    [
      ["/", "GET"],
      ["/login", "POST"],
      ["/search", "GET"],
      ["/detail", "GET"],
    ],
  );
  assert.equal(requests[1].cookie, "anonymous=one");
  assert.match(requests[1].contentType ?? "", /multipart\/form-data; boundary=/);
  assert.match(requests[1].body, /debug@example\.test/);
  assert.equal(requests[2].cookie, "access_token=two");
});
