import assert from "node:assert/strict";
import test from "node:test";

import type { ProxyResponseEnvelope } from "../../src/proxy/protocol.ts";
import { createServiceFetch } from "../../src/proxy/serviceFetch.ts";

test("direct mode delegates to fetch unchanged", async () => {
  const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
  const fetchImpl = (async (input, init) => {
    calls.push([input, init]);
    return new Response("direct", { status: 200 });
  }) satisfies typeof fetch;

  const serviceFetch = createServiceFetch({ env: {}, fetchImpl });
  assert.equal(
    await (await serviceFetch("https://prehraj.to/")).text(),
    "direct",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://prehraj.to/");
});

test("proxy mode serializes multipart requests and reconstructs cookies", async () => {
  let envelope: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const proxyResponse: ProxyResponseEnvelope = {
    status: 200,
    statusText: "OK",
    headers: [["set-cookie", "access_token=abc; Path=/"]],
    url: "https://prehraj.to/login",
    bodyBase64: Buffer.from("logged-in").toString("base64"),
    requestId: "request-1",
  };
  const fetchImpl = (async (input, init) => {
    assert.equal(
      String(input),
      "https://relay.test/internal/service-proxy",
    );
    authorization = new Headers(init?.headers).get("authorization");
    envelope = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(proxyResponse);
  }) satisfies typeof fetch;
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  const form = new FormData();
  form.set("email", "person@example.test");
  const response = await serviceFetch("https://prehraj.to/login", {
    method: "POST",
    body: form,
  });
  const envelopeHeaders = envelope?.headers as string[][];
  assert.match(
    String(
      envelopeHeaders.find(([name]) => name === "content-type")?.[1],
    ),
    /multipart\/form-data; boundary=/,
  );
  assert.ok(typeof envelope?.bodyBase64 === "string");
  assert.equal(authorization, "Bearer secret");
  assert.deepEqual(response.headers.getSetCookie(), [
    "access_token=abc; Path=/",
  ]);
  assert.equal(await response.text(), "logged-in");
});

test("proxy errors include only safe relay context", async () => {
  const fetchImpl = (async () =>
    Response.json(
      {
        error: {
          code: "UPSTREAM_TIMEOUT",
          message: "Upstream request timed out",
          requestId: "request-2",
        },
      },
      { status: 504 },
    )) satisfies typeof fetch;
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  await assert.rejects(
    serviceFetch("https://prehraj.to/private?password=hidden"),
    (error: unknown) => {
      assert.match(String(error), /UPSTREAM_TIMEOUT.*request-2/);
      assert.doesNotMatch(String(error), /password|hidden/);
      return true;
    },
  );
});

test("proxy mode rejects malformed success payloads", async () => {
  const fetchImpl = (async () =>
    Response.json({ status: "ok" })) satisfies typeof fetch;
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  await assert.rejects(
    serviceFetch("https://prehraj.to/"),
    /malformed response/,
  );
});
