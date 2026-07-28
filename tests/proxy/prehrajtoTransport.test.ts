import { describe, expect, it, vi } from "vitest";

import type { OuterRequest } from "../../src/proxy/serviceFetch.ts";
import { getResolver } from "../../src/service/prehrajto.ts";

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
};

const proxyPolicy = {
  resolveHostname: vi.fn(async () => [
    { address: "93.184.216.34", family: 4 as const },
  ]),
};

function controlPlaneResponse(url: string) {
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
        var sources = [{file: "https://media.example.test/movie.mp4"}];
        var tracks = [];
      </script>
    `);
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

function createDirectFetch(calls: Call[]) {
  return (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    return controlPlaneResponse(url);
  }) satisfies typeof fetch;
}

describe("PrehrajTo transport selection", () => {
  it("cancels successful header-only authentication response bodies", async () => {
    const cancelAnonymous = vi.fn();
    const cancelLogin = vi.fn();
    const fetchImpl = (async (input) => {
      const url = String(input);
      if (url === "https://prehraj.to/") {
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelAnonymous,
          }),
          {
            headers: { "set-cookie": "anonymous=one; Path=/" },
          },
        );
      }
      if (url.includes("frm=loginDialog")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelLogin,
          }),
          {
            headers: { "set-cookie": "access_token=two; Path=/" },
          },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) satisfies typeof fetch;
    const resolver = getResolver(fetchImpl);

    await expect(
      resolver.validateConfig({
        prehrajtoUsername: "body-cleanup@example.test",
        prehrajtoPassword: "not-a-real-secret",
      }),
    ).resolves.toBe(true);

    expect(cancelAnonymous).toHaveBeenCalledOnce();
    expect(cancelLogin).toHaveBeenCalledOnce();

    await resolver.cleanup?.();
  });

  it("uses the injected direct transport only for control-plane requests", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Headers;
      body: RequestInit["body"];
    }> = [];
    const fetchImpl = createDirectFetch(calls);

    const resolver = getResolver(fetchImpl);
    const config = {
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
    };

    expect(await resolver.validateConfig(config)).toBe(true);
    const results = await resolver.search("Movie 2026", config);
    expect(results).toHaveLength(1);
    const details = await resolver.resolve(results[0].resolverId, config);
    expect(details.video).toBe("https://media.example.test/movie.mp4");

    expect(calls.map(({ url, method }) => [url, method])).toEqual([
      ["https://prehraj.to/", "GET"],
      ["https://prehraj.to/?frm=loginDialog-login-loginForm", "POST"],
      ["https://prehraj.to/hledej/Movie%202026?vp-page=0", "GET"],
      ["https://prehraj.to/video/1", "GET"],
    ]);
    expect(calls[1].body).toBeInstanceOf(FormData);
    expect(calls[2].headers.get("cookie")).toBe("access_token=two");
    expect(
      calls.some(({ url }) => url.startsWith("https://media.example.test/")),
    ).toBe(false);

    await resolver.cleanup?.();
  });

  it("routes anonymous, login, search, and detail requests through the configured proxy", async () => {
    const directFetch = vi.fn<typeof fetch>();
    const proxyCalls: Array<{ apiKey: string; target: Request }> = [];
    const outerRequest: OuterRequest = async (_endpoint, init) => {
      const wrapper = JSON.parse(String(init.body)) as {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
      };
      proxyCalls.push({
        apiKey: new Headers(init.headers).get("x-api-key") ?? "",
        target: new Request(wrapper.url, {
          method: wrapper.method,
          headers: wrapper.headers,
          body: wrapper.body,
        }),
      });
      return controlPlaneResponse(wrapper.url);
    };
    const resolver = getResolver(directFetch, {
      proxyPolicy,
      outerRequest,
    });
    const config = {
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
      proxyUrl: "https://proxy.example.test/proxy",
      proxyApiKey: "proxy-secret",
    };

    expect(await resolver.validateConfig(config)).toBe(true);
    const results = await resolver.search("Movie 2026", config);
    const details = await resolver.resolve(results[0].resolverId, config);

    expect(details.video).toBe("https://media.example.test/movie.mp4");
    expect(directFetch).not.toHaveBeenCalled();
    expect(proxyCalls.map(({ target }) => [target.url, target.method])).toEqual(
      [
        ["https://prehraj.to/", "GET"],
        ["https://prehraj.to/?frm=loginDialog-login-loginForm", "POST"],
        ["https://prehraj.to/hledej/Movie%202026?vp-page=0", "GET"],
        ["https://prehraj.to/video/1", "GET"],
      ],
    );
    expect(proxyCalls.every(({ apiKey }) => apiKey === "proxy-secret")).toBe(
      true,
    );
    expect(proxyCalls[2].target.headers.get("cookie")).toBe("access_token=two");
    expect(
      proxyCalls.some(({ target }) =>
        target.url.startsWith("https://media.example.test/"),
      ),
    ).toBe(false);

    await resolver.cleanup?.();
  });

  it("fails closed on partial or unsafe proxy settings before direct egress", async () => {
    const directFetch = vi.fn<typeof fetch>();
    const outerRequest = vi.fn<OuterRequest>();
    const resolver = getResolver(directFetch, {
      proxyPolicy: {
        resolveHostname: async () => [
          { address: "192.168.1.10", family: 4 as const },
        ],
      },
      outerRequest,
    });
    const credentials = {
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
    };

    await expect(
      resolver.validateConfig({
        ...credentials,
        proxyUrl: "https://proxy.example.test/proxy",
      }),
    ).rejects.toThrow("Proxy URL and API key must be configured together");
    await expect(
      resolver.search("Movie 2026", {
        ...credentials,
        proxyUrl: "https://proxy.example.test/proxy",
        proxyApiKey: "proxy-secret",
      }),
    ).rejects.toThrow("Proxy endpoint is invalid or unsafe");
    expect(directFetch).not.toHaveBeenCalled();
    expect(outerRequest).not.toHaveBeenCalled();
  });

  it("partitions cached authentication by direct mode and proxy identity", async () => {
    const directCalls: Call[] = [];
    const directFetch = createDirectFetch(directCalls);
    const proxyTargets: string[] = [];
    const outerRequest: OuterRequest = async (_endpoint, init) => {
      const wrapper = JSON.parse(String(init.body)) as { url: string };
      proxyTargets.push(wrapper.url);
      return controlPlaneResponse(wrapper.url);
    };
    const resolver = getResolver(directFetch, {
      proxyPolicy,
      outerRequest,
    });
    const credentials = {
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
    };

    await resolver.validateConfig(credentials);
    await resolver.validateConfig({
      ...credentials,
      proxyUrl: "https://proxy.example.test/proxy",
      proxyApiKey: "proxy-secret-a",
    });
    await resolver.validateConfig({
      ...credentials,
      proxyUrl: "https://proxy.example.test/proxy",
      proxyApiKey: "proxy-secret-b",
    });

    expect(directCalls.map(({ url }) => url)).toEqual([
      "https://prehraj.to/",
      "https://prehraj.to/?frm=loginDialog-login-loginForm",
    ]);
    expect(proxyTargets).toEqual([
      "https://prehraj.to/",
      "https://prehraj.to/?frm=loginDialog-login-loginForm",
      "https://prehraj.to/",
      "https://prehraj.to/?frm=loginDialog-login-loginForm",
    ]);

    await resolver.cleanup?.();
  });

  it("uses the configured transport for debug login calls", async () => {
    const directFetch = vi.fn<typeof fetch>();
    const proxyTargets: string[] = [];
    const outerRequest: OuterRequest = async (_endpoint, init) => {
      const wrapper = JSON.parse(String(init.body)) as { url: string };
      proxyTargets.push(wrapper.url);
      return controlPlaneResponse(wrapper.url);
    };
    const resolver = getResolver(directFetch, {
      proxyPolicy,
      outerRequest,
    });

    await resolver.debug?.({
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
      proxyUrl: "https://proxy.example.test/proxy",
      proxyApiKey: "proxy-secret",
    });

    expect(directFetch).not.toHaveBeenCalled();
    expect(proxyTargets).toEqual([
      "https://prehraj.to/",
      "https://prehraj.to/?frm=loginDialog-login-loginForm",
    ]);

    await resolver.cleanup?.();
  });

  it("rejects unsuccessful control-plane responses before parsing without exposing the body", async () => {
    const cancelFailedResponse = vi.fn(() =>
      Promise.reject(new Error("cancel failed")),
    );
    const fetchImpl = (async (input, init) => {
      const url = String(input);
      if (url.includes("/hledej/")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelFailedResponse,
          }),
          { status: 502 },
        );
      }
      return createDirectFetch([])(input, init);
    }) satisfies typeof fetch;
    const resolver = getResolver(fetchImpl);
    const config = {
      prehrajtoUsername: "debug@example.test",
      prehrajtoPassword: "not-a-real-secret",
    };

    await resolver.validateConfig(config);
    await expect(resolver.search("Movie 2026", config)).rejects.toThrow(
      "PrehrajTo search request failed (502)",
    );
    await expect(resolver.search("Movie 2026", config)).rejects.not.toThrow(
      "secret upstream diagnostic",
    );
    expect(cancelFailedResponse).toHaveBeenCalledTimes(2);

    await resolver.cleanup?.();
  });
});
