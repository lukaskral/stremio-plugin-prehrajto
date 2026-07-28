import { describe, expect, it, vi } from "vitest";

import type { ProxyTransportConfig } from "../../src/proxy/config.ts";
import {
  createServiceFetch,
  type OuterRequest,
} from "../../src/proxy/serviceFetch.ts";

const undici = vi.hoisted(() => ({
  agentOptions: [] as Array<{
    connect?: {
      servername?: string;
      lookup?: (
        hostname: string,
        options: unknown,
        callback: (error: null, address: string, family: number) => void,
      ) => void;
    };
  }>,
  fetch: vi.fn(async () => new Response("proxied")),
}));

vi.mock("undici", () => ({
  Agent: class {
    constructor(options: (typeof undici.agentOptions)[number]) {
      undici.agentOptions.push(options);
    }
  },
  fetch: undici.fetch,
}));

const proxyConfig: ProxyTransportConfig = {
  mode: "proxy",
  endpoint: new URL("https://proxy.example.test/proxy"),
  apiKey: "very-secret-key",
  connection: {
    address: "93.184.216.34",
    family: 4,
    servername: "proxy.example.test",
  },
};

function createOuterRequest(responses: Response | Response[]): {
  outerRequest: OuterRequest;
  calls: Array<{
    endpoint: URL;
    init: RequestInit;
    connection: ProxyTransportConfig["connection"];
  }>;
} {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: Array<{
    endpoint: URL;
    init: RequestInit;
    connection: ProxyTransportConfig["connection"];
  }> = [];
  return {
    calls,
    outerRequest: async (endpoint, init, connection) => {
      calls.push({ endpoint, init, connection });
      const response = queue.shift();
      if (!response) {
        throw new Error("Unexpected outer request");
      }
      return response;
    },
  };
}

function wrapper(call: { init: RequestInit }): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  return JSON.parse(String(call.init.body)) as {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
}

describe("service fetch", () => {
  it("delegates direct-mode input and init unchanged", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("direct"));
    const init = { headers: { cookie: "session=abc" } };
    const serviceFetch = createServiceFetch({
      config: { mode: "direct" },
      fetchImpl,
    });

    expect(await (await serviceFetch("https://prehraj.to/", init)).text()).toBe(
      "direct",
    );
    expect(fetchImpl).toHaveBeenCalledWith("https://prehraj.to/", init);
  });

  it("wraps GET requests with a plain header object and pinned connection", async () => {
    const { outerRequest, calls } = createOuterRequest(
      new Response("<html>ok</html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "set-cookie": "access_token=abc; Path=/",
        },
      }),
    );
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });

    const response = await serviceFetch(
      "https://prehraj.to/search?query=secret-title",
      { headers: { cookie: "session=abc", accept: "text/html" } },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toEqual(proxyConfig.endpoint);
    expect(calls[0].connection).toEqual(proxyConfig.connection);
    expect(calls[0].init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-api-key": "very-secret-key",
      },
    });
    expect(wrapper(calls[0])).toEqual({
      url: "https://prehraj.to/search?query=secret-title",
      method: "GET",
      headers: {
        accept: "text/html",
        cookie: "session=abc",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.getSetCookie()).toEqual([
      "access_token=abc; Path=/",
    ]);
    expect(await response.text()).toBe("<html>ok</html>");
  });

  it("pins the production outer connection while retaining the TLS hostname", async () => {
    undici.agentOptions.length = 0;
    undici.fetch.mockClear();
    const serviceFetch = createServiceFetch({ config: proxyConfig });

    expect(await (await serviceFetch("https://prehraj.to/")).text()).toBe(
      "proxied",
    );

    const connect = undici.agentOptions[0]?.connect;
    expect(connect?.servername).toBe("proxy.example.test");
    const lookupResult = await new Promise<{
      address: string;
      family: number;
    }>((resolve) => {
      connect?.lookup?.("proxy.example.test", {}, (_error, address, family) => {
        resolve({ address, family });
      });
    });
    expect(lookupResult).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    expect(undici.fetch).toHaveBeenCalledWith(
      proxyConfig.endpoint,
      expect.objectContaining({
        redirect: "manual",
        dispatcher: expect.anything(),
      }),
    );
  });

  it("reuses the production dispatcher across service fetch instances", async () => {
    undici.agentOptions.length = 0;
    undici.fetch.mockClear();
    const reusableConfig: ProxyTransportConfig = {
      ...proxyConfig,
      endpoint: new URL("https://proxy-reuse.example.test/proxy"),
      connection: {
        ...proxyConfig.connection,
        servername: "proxy-reuse.example.test",
      },
    };

    await createServiceFetch({ config: reusableConfig })("https://prehraj.to/");
    await createServiceFetch({ config: reusableConfig })("https://prehraj.to/");

    expect(undici.agentOptions).toHaveLength(1);
  });

  it("serializes multipart POST bodies as strings with their generated boundary", async () => {
    const { outerRequest, calls } = createOuterRequest(new Response("ok"));
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });
    const form = new FormData();
    form.set("email", "person@example.test");
    form.set("password", "heslo");

    await serviceFetch("https://prehraj.to/login", {
      method: "POST",
      body: form,
    });

    const payload = wrapper(calls[0]);
    expect(payload.method).toBe("POST");
    expect(payload.headers["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(payload.body).toContain('name="email"');
    expect(payload.body).toContain("person@example.test");
    expect(payload.body).toContain('name="password"');
    expect(payload.body).toContain("heslo");
  });

  it.each([400, 401, 403, 502, 504])(
    "passes through HTTP %i responses unchanged",
    async (status) => {
      const { outerRequest } = createOuterRequest(
        new Response("generic failure", {
          status,
          headers: { "x-service": "proxy-or-upstream" },
        }),
      );
      const serviceFetch = createServiceFetch({
        config: proxyConfig,
        outerRequest,
      });

      const response = await serviceFetch("https://prehraj.to/");

      expect(response.status).toBe(status);
      expect(response.headers.get("x-service")).toBe("proxy-or-upstream");
      expect(await response.text()).toBe("generic failure");
    },
  );

  it("converts a same-origin 302 after POST to a wrapped GET", async () => {
    const { outerRequest, calls } = createOuterRequest([
      new Response(null, {
        status: 302,
        headers: { location: "/account" },
      }),
      new Response("account"),
    ]);
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });

    expect(
      await (
        await serviceFetch("https://prehraj.to/login", {
          method: "POST",
          headers: { "content-type": "text/plain", "x-request": "kept" },
          body: "credentials",
        })
      ).text(),
    ).toBe("account");

    expect(wrapper(calls[1])).toEqual({
      url: "https://prehraj.to/account",
      method: "GET",
      headers: { "x-request": "kept" },
    });
    expect(
      calls.every(
        ({ endpoint }) => endpoint.href === proxyConfig.endpoint.href,
      ),
    ).toBe(true);
  });

  it("preserves method and body on same-origin 307 redirects", async () => {
    const { outerRequest, calls } = createOuterRequest([
      new Response(null, {
        status: 307,
        headers: { location: "/login/continued" },
      }),
      new Response("done"),
    ]);
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });

    await serviceFetch("https://prehraj.to/login", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "credentials",
    });

    expect(wrapper(calls[1])).toEqual({
      url: "https://prehraj.to/login/continued",
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: "credentials",
    });
  });

  it.each([
    ["cross-origin", "https://evil.example/path"],
    ["HTTPS downgrade", "http://prehraj.to/path"],
    ["credential-bearing", "https://user:pass@prehraj.to/path"],
  ])(
    "rejects %s redirects, cancels their bodies, and does not leak secrets",
    async (_name, location) => {
      const cancel = vi.fn();
      const { outerRequest, calls } = createOuterRequest(
        new Response(
          new ReadableStream({
            cancel,
          }),
          { status: 302, headers: { location } },
        ),
      );
      const serviceFetch = createServiceFetch({
        config: proxyConfig,
        outerRequest,
      });

      const error = await serviceFetch(
        "https://prehraj.to/private?password=hidden",
      ).catch((value: unknown) => value);

      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe("Error: Service redirect is not allowed");
      expect(String(error)).not.toMatch(
        /very-secret-key|password|hidden|evil\.example|user:pass/,
      );
      expect(calls).toHaveLength(1);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("times out a stalled outer proxy request with a sanitized error", async () => {
    let receivedSignal: AbortSignal | null = null;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const outerRequest: OuterRequest = async (_endpoint, init) => {
      receivedSignal = init.signal as AbortSignal;
      markStarted?.();
      return await new Promise<Response>(() => undefined);
    };
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
      outerRequestTimeoutMs: 5,
    });

    const result = serviceFetch(
      "https://prehraj.to/private?password=hidden",
    ).catch((error: unknown) => error);
    await started;
    const error = await result;

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe("Error: Service proxy request timed out");
    expect(String(error)).not.toMatch(
      /very-secret-key|password|hidden|proxy\.example/,
    );
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("preserves caller aborts while an outer proxy request is stalled", async () => {
    const caller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const outerRequest: OuterRequest = async () => {
      markStarted?.();
      return await new Promise<Response>(() => undefined);
    };
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
      outerRequestTimeoutMs: 10_000,
    });

    const result = serviceFetch("https://prehraj.to/", {
      signal: caller.signal,
    }).catch((error: unknown) => error);
    await started;
    caller.abort();
    const error = await result;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  it("rejects non-PrehrajTo initial targets before contacting the proxy", async () => {
    const outerRequest = vi.fn<OuterRequest>();
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });

    await expect(
      serviceFetch("https://media.example.test/private?token=hidden"),
    ).rejects.toThrow("Service target is not allowed");
    expect(outerRequest).not.toHaveBeenCalled();
  });

  it("rejects a sixth redirect and never sends a target directly", async () => {
    const redirects = Array.from(
      { length: 6 },
      (_, index) =>
        new Response(null, {
          status: 302,
          headers: { location: `/step-${index + 1}` },
        }),
    );
    const { outerRequest, calls } = createOuterRequest(redirects);
    const serviceFetch = createServiceFetch({
      config: proxyConfig,
      outerRequest,
    });

    await expect(serviceFetch("https://prehraj.to/start")).rejects.toThrow(
      "Service redirect limit exceeded",
    );
    expect(calls).toHaveLength(6);
    expect(
      calls.every(
        ({ endpoint }) => endpoint.href === proxyConfig.endpoint.href,
      ),
    ).toBe(true);
  });
});
