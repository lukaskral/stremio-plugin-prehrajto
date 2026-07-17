import { expect, it } from "vitest";

import type { ProxyResponseEnvelope } from "../../src/proxy/protocol.ts";
import { createServiceFetch } from "../../src/proxy/serviceFetch.ts";

it("direct mode delegates to fetch unchanged", async () => {
  const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
  const fetchImpl = (async (input, init) => {
    calls.push([input, init]);
    return new Response("direct", { status: 200 });
  }) satisfies typeof fetch;

  const serviceFetch = createServiceFetch({ env: {}, fetchImpl });
  expect(
    await (await serviceFetch("https://prehraj.to/")).text(),
  ).toBe("direct");
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("https://prehraj.to/");
});

it("proxy mode serializes multipart requests and reconstructs cookies", async () => {
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
    expect(
      String(input),
    ).toBe("https://relay.test/internal/service-proxy");
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
  expect(
    String(
      envelopeHeaders.find(([name]) => name === "content-type")?.[1],
    ),
  ).toMatch(/multipart\/form-data; boundary=/);
  expect(typeof envelope?.bodyBase64).toBe("string");
  expect(authorization).toBe("Bearer secret");
  expect(response.headers.getSetCookie()).toEqual([
    "access_token=abc; Path=/",
  ]);
  expect(await response.text()).toBe("logged-in");
});

it("proxy errors include only safe relay context", async () => {
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
  const error = await serviceFetch(
    "https://prehraj.to/private?password=hidden",
  ).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toMatch(/UPSTREAM_TIMEOUT.*request-2/);
  expect(String(error)).not.toMatch(/password|hidden/);
});

it("proxy mode rejects malformed success payloads", async () => {
  const fetchImpl = (async () =>
    Response.json({ status: "ok" })) satisfies typeof fetch;
  const serviceFetch = createServiceFetch({
    env: {
      SERVICE_PROXY_URL: "https://relay.test/internal/service-proxy",
      SERVICE_PROXY_CLIENT_TOKEN: "secret",
    },
    fetchImpl,
  });
  await expect(serviceFetch("https://prehraj.to/")).rejects.toThrow(
    /malformed response/,
  );
});
