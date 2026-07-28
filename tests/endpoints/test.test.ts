import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestHandler } from "../../src/endpoints/test.ts";
import type { OuterRequest } from "../../src/proxy/serviceFetch.ts";

type FetchCall = {
  url: string;
  method: string;
  headers: Headers;
};

const proxyPolicy = {
  resolveHostname: vi.fn(async () => [
    { address: "93.184.216.34", family: 4 as const },
  ]),
};

function prehrajtoResponse(url: string) {
  if (url === "https://prehraj.to/") {
    return new Response("home", {
      headers: { "set-cookie": "anonymous=one; Path=/" },
    });
  }
  if (url.includes("frm=loginDialog")) {
    return new Response("logged-in", {
      headers: { "set-cookie": "access_token=two; Path=/" },
    });
  }
  if (url.includes("/hledej/")) {
    return new Response(`
      <a class="video--link" href="/video/1" title="Movie 2026">
        <span class="video__tag--size">1 GB</span>
        <span class="video__tag--time">01:30:00</span>
      </a>
    `);
  }
  if (url === "https://prehraj.to/video/1") {
    return new Response(`
      <script>
        var sources = [{file: "https://media.example.test/movie.mp4?token=media-query-sentinel"}];
        var tracks = [];
      </script>
    `);
  }
  throw new Error(`Unexpected control-plane request: ${url}`);
}

function createResponse() {
  const chunks: string[] = [];
  const response = {
    writeHead: vi.fn(),
    write: vi.fn((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk !== undefined) {
        chunks.push(String(chunk));
      }
    }),
  } as unknown as Response;
  return { response, chunks };
}

function createRequest(query = "") {
  return {
    protocol: "https",
    hostname: "addon.example.test",
    url: `/test/${query}`,
    headers: {
      authorization: `Bearer ${process.env.TEST_ENDPOINT_BEARER_TOKEN}`,
    },
  } as Request;
}

function expectPrivateResponse(response: Response, status: number) {
  expect(response.writeHead).toHaveBeenCalledWith(
    status,
    expect.objectContaining({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
  );
}

describe("/test", () => {
  beforeEach(() => {
    process.env.TEST_ENDPOINT_BEARER_TOKEN = "diagnostic-access-secret";
    process.env.PREHRAJTO_DEBUG_USERNAME = "debug-username-sentinel";
    process.env.PREHRAJTO_DEBUG_PASSWORD = "debug-password-sentinel";
    proxyPolicy.resolveHostname.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_ENDPOINT_BEARER_TOKEN;
    delete process.env.PREHRAJTO_DEBUG_USERNAME;
    delete process.env.PREHRAJTO_DEBUG_PASSWORD;
    vi.restoreAllMocks();
  });

  it("returns 503 before parsing proxy input or making egress when endpoint auth is not configured", async () => {
    delete process.env.TEST_ENDPOINT_BEARER_TOKEN;
    const directFetch = vi.fn<typeof fetch>();
    const outerRequest = vi.fn<OuterRequest>();
    const handler = createTestHandler({
      fetchImpl: directFetch,
      outerRequest,
      proxyPolicy,
    });
    const { response, chunks } = createResponse();

    await handler(
      createRequest(
        "?proxyUrl=https%3A%2F%2Fproxy-url-sentinel.invalid%2Fproxy&proxyApiKey=proxy-key-sentinel",
      ),
      response,
    );

    expectPrivateResponse(response, 503);
    expect(proxyPolicy.resolveHostname).not.toHaveBeenCalled();
    expect(directFetch).not.toHaveBeenCalled();
    expect(outerRequest).not.toHaveBeenCalled();
    expect(chunks.join(" ")).not.toMatch(
      /proxy-url-sentinel|proxy-key-sentinel|debug-username-sentinel|debug-password-sentinel/,
    );
  });

  it.each([
    ["missing", undefined],
    ["invalid", "Bearer wrong-diagnostic-secret"],
    ["wrong scheme", "Basic diagnostic-access-secret"],
  ])(
    "returns 401 before parsing proxy input or making egress for %s authorization",
    async (_case, authorization) => {
      const directFetch = vi.fn<typeof fetch>();
      const outerRequest = vi.fn<OuterRequest>();
      const handler = createTestHandler({
        fetchImpl: directFetch,
        outerRequest,
        proxyPolicy,
      });
      const { response, chunks } = createResponse();
      const request = createRequest(
        "?proxyUrl=https%3A%2F%2Fproxy-url-sentinel.invalid%2Fproxy&proxyApiKey=proxy-key-sentinel",
      );
      request.headers = authorization ? { authorization } : {};

      await handler(request, response);

      expectPrivateResponse(response, 401);
      expect(response.writeHead).toHaveBeenCalledWith(
        401,
        expect.objectContaining({
          "WWW-Authenticate": "Bearer",
        }),
      );
      expect(proxyPolicy.resolveHostname).not.toHaveBeenCalled();
      expect(directFetch).not.toHaveBeenCalled();
      expect(outerRequest).not.toHaveBeenCalled();
      expect(chunks.join(" ")).not.toMatch(
        /proxy-url-sentinel|proxy-key-sentinel|debug-username-sentinel|debug-password-sentinel|wrong-diagnostic-secret/,
      );
    },
  );

  it("returns 503 without egress when debug credentials are not configured", async () => {
    delete process.env.PREHRAJTO_DEBUG_PASSWORD;
    const directFetch = vi.fn<typeof fetch>();
    const handler = createTestHandler({ fetchImpl: directFetch, proxyPolicy });
    const { response, chunks } = createResponse();

    await handler(createRequest("?q=target-query-sentinel"), response);

    expectPrivateResponse(response, 503);
    expect(directFetch).not.toHaveBeenCalled();
    expect(chunks.join(" ")).not.toContain("target-query-sentinel");
  });

  it("uses direct control-plane requests by default and fetches final media directly", async () => {
    const calls: FetchCall[] = [];
    const directFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
      });
      if (request.url.startsWith("https://media.example.test/")) {
        return new Response(null, { status: 206 });
      }
      return prehrajtoResponse(request.url);
    });
    const outerRequest = vi.fn<OuterRequest>();
    const handler = createTestHandler({
      fetchImpl: directFetch,
      outerRequest,
      proxyPolicy,
    });
    const { response, chunks } = createResponse();

    await handler(createRequest("?q=Movie"), response);

    expectPrivateResponse(response, 200);
    expect(outerRequest).not.toHaveBeenCalled();
    expect(calls.some(({ url }) => url.includes("prehraj.to"))).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      url: "https://media.example.test/movie.mp4?token=media-query-sentinel",
      method: "GET",
    });
    expect(calls.at(-1)?.headers.get("range")).toBe("bytes=0-1023");
    expect(chunks.at(-1)).toContain("OK: 206");
  });

  it("proxies only PrehrajTo control-plane requests and keeps final media direct", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const directFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith("https://media.example.test/")) {
        return new Response(null, { status: 206 });
      }
      throw new Error(`Unexpected direct request: ${request.url}`);
    });
    const proxyTargets: string[] = [];
    const outerRequest: OuterRequest = async (_endpoint, init) => {
      const wrapper = JSON.parse(String(init.body)) as { url: string };
      proxyTargets.push(wrapper.url);
      expect(new Headers(init.headers).get("x-api-key")).toBe(
        "proxy-key-sentinel",
      );
      return prehrajtoResponse(wrapper.url);
    };
    const handler = createTestHandler({
      fetchImpl: directFetch,
      outerRequest,
      proxyPolicy,
    });
    const { response, chunks } = createResponse();

    await handler(
      createRequest(
        "?q=target-query-sentinel&proxyUrl=https%3A%2F%2Fproxy-url-sentinel.example.test%2Fproxy&proxyApiKey=proxy-key-sentinel",
      ),
      response,
    );

    expectPrivateResponse(response, 200);
    expect(proxyTargets.length).toBeGreaterThan(0);
    expect(
      proxyTargets.every((url) => url.startsWith("https://prehraj.to/")),
    ).toBe(true);
    expect(directFetch).toHaveBeenCalledOnce();
    expect(String(directFetch.mock.calls[0][0])).toBe(
      "https://media.example.test/movie.mp4?token=media-query-sentinel",
    );
    expect(chunks.at(-1)).toContain("OK: 206");
    const exposed = [
      chunks.join(" "),
      ...consoleError.mock.calls.flat().map(String),
    ].join(" ");
    expect(exposed).not.toMatch(
      /proxy-url-sentinel|proxy-key-sentinel|debug-username-sentinel|debug-password-sentinel|target-query-sentinel|media-query-sentinel/,
    );
  });

  it("rejects partial proxy query configuration before any egress", async () => {
    const directFetch = vi.fn<typeof fetch>();
    const outerRequest = vi.fn<OuterRequest>();
    const handler = createTestHandler({
      fetchImpl: directFetch,
      outerRequest,
      proxyPolicy,
    });
    const { response, chunks } = createResponse();

    await handler(
      createRequest("?proxyApiKey=do-not-echo-this-secret"),
      response,
    );

    expectPrivateResponse(response, 400);
    expect(directFetch).not.toHaveBeenCalled();
    expect(outerRequest).not.toHaveBeenCalled();
    expect(proxyPolicy.resolveHostname).not.toHaveBeenCalled();
    expect(chunks.join(" ")).not.toContain("do-not-echo-this-secret");
  });

  it("redacts request and credential sentinels from a failed diagnostic response and logs", async () => {
    const sentinels = [
      "proxy-url-sentinel",
      "proxy-key-sentinel",
      "debug-username-sentinel",
      "debug-password-sentinel",
      "target-query-sentinel",
      "media-query-sentinel",
    ];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const directFetch = vi.fn<typeof fetch>();
    const outerRequest = vi.fn<OuterRequest>(async () => {
      throw new Error(sentinels.join(" "));
    });
    const handler = createTestHandler({
      fetchImpl: directFetch,
      outerRequest,
      proxyPolicy,
    });
    const { response, chunks } = createResponse();

    await handler(
      createRequest(
        "?q=target-query-sentinel&proxyUrl=https%3A%2F%2Fproxy-url-sentinel.example.test%2Fproxy&proxyApiKey=proxy-key-sentinel",
      ),
      response,
    );

    expectPrivateResponse(response, 502);
    expect(directFetch).not.toHaveBeenCalled();
    expect(outerRequest).toHaveBeenCalled();
    const exposed = [
      chunks.join(" "),
      ...consoleError.mock.calls.flat().map(String),
    ].join(" ");
    for (const sentinel of sentinels) {
      expect(exposed).not.toContain(sentinel);
    }
  });
});
