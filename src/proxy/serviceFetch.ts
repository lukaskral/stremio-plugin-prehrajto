import { Agent, fetch as undiciFetch } from "undici";

import type { ProxyTransportConfig, TransportConfig } from "./config.ts";

export type OuterRequest = (
  endpoint: URL,
  init: RequestInit,
  connection: ProxyTransportConfig["connection"],
) => Promise<Response>;

type ServiceFetchDependencies = {
  config?: TransportConfig;
  fetchImpl?: typeof fetch;
  outerRequest?: OuterRequest;
  outerRequestTimeoutMs?: number;
};

type ProxyRequestBody = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_PINNED_DISPATCHERS = 32;
const PREHRAJTO_ORIGIN = "https://prehraj.to";
const DEFAULT_OUTER_REQUEST_TIMEOUT_MS = 15_000;

function createPinnedOuterRequest(): OuterRequest {
  const dispatchers = new Map<string, Agent>();

  return async (endpoint, init, connection) => {
    const dispatcherKey = [
      endpoint.origin,
      connection.address,
      connection.family,
      connection.servername,
    ].join("\0");
    let dispatcher = dispatchers.get(dispatcherKey);
    if (!dispatcher) {
      if (dispatchers.size >= MAX_PINNED_DISPATCHERS) {
        const oldestKey = dispatchers.keys().next().value;
        if (oldestKey !== undefined) {
          const oldestDispatcher = dispatchers.get(oldestKey);
          dispatchers.delete(oldestKey);
          void oldestDispatcher?.close().catch((): undefined => undefined);
        }
      }
      dispatcher = new Agent({
        connect: {
          servername: connection.servername,
          lookup: (_hostname, _options, callback) => {
            callback(null, connection.address, connection.family);
          },
        },
      });
      dispatchers.set(dispatcherKey, dispatcher);
    } else {
      dispatchers.delete(dispatcherKey);
      dispatchers.set(dispatcherKey, dispatcher);
    }

    return (await undiciFetch(endpoint, {
      ...init,
      dispatcher,
    })) as unknown as Response;
  };
}

const pinnedOuterRequest = createPinnedOuterRequest();

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

async function requestToProxyBody(request: Request): Promise<ProxyRequestBody> {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.clone().text();

  return {
    url: request.url,
    method: request.method,
    headers: headersToObject(request.headers),
    ...(body !== undefined ? { body } : {}),
  };
}

async function outerRequestWithDeadline(
  outerRequest: OuterRequest,
  endpoint: URL,
  init: RequestInit,
  connection: ProxyTransportConfig["connection"],
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  if (callerSignal.aborted) {
    throw callerSignal.reason;
  }

  const timeoutError = new Error("Service proxy request timed out");
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([callerSignal, timeoutController.signal]);
  let rejectOnAbort: (() => void) | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  const timeout = setTimeout(() => {
    timeoutController.abort(timeoutError);
  }, timeoutMs);

  try {
    return await Promise.race([
      outerRequest(endpoint, { ...init, signal }, connection),
      abort,
    ]);
  } finally {
    clearTimeout(timeout);
    if (rejectOnAbort) {
      signal.removeEventListener("abort", rejectOnAbort);
    }
  }
}

function redirectedRequest(
  request: Request,
  response: Response,
): Request | null {
  if (!REDIRECT_STATUSES.has(response.status)) {
    return null;
  }
  const location = response.headers.get("location");
  if (!location) {
    return null;
  }

  let target: URL;
  try {
    target = new URL(location, request.url);
  } catch {
    throw new Error("Service redirect is not allowed");
  }
  if (
    target.origin !== PREHRAJTO_ORIGIN ||
    target.username ||
    target.password
  ) {
    throw new Error("Service redirect is not allowed");
  }

  const changesToGet =
    response.status === 303
      ? request.method !== "HEAD"
      : (response.status === 301 || response.status === 302) &&
        request.method === "POST";
  if (!changesToGet) {
    return new Request(target, request);
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  headers.delete("transfer-encoding");
  return new Request(target, {
    method: "GET",
    headers,
    signal: request.signal,
  });
}

export function createServiceFetch({
  config = { mode: "direct" },
  fetchImpl = globalThis.fetch,
  outerRequest = pinnedOuterRequest,
  outerRequestTimeoutMs = DEFAULT_OUTER_REQUEST_TIMEOUT_MS,
}: ServiceFetchDependencies = {}): typeof fetch {
  if (config.mode === "direct") {
    return fetchImpl;
  }

  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    let request = new Request(input, init);
    if (new URL(request.url).origin !== PREHRAJTO_ORIGIN) {
      throw new Error("Service target is not allowed");
    }

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await outerRequestWithDeadline(
        outerRequest,
        config.endpoint,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
          },
          body: JSON.stringify(await requestToProxyBody(request)),
        },
        config.connection,
        request.signal,
        outerRequestTimeoutMs,
      );
      let nextRequest: Request | null;
      try {
        nextRequest = redirectedRequest(request, response);
      } catch (error) {
        await response.body?.cancel().catch((): undefined => undefined);
        throw error;
      }
      if (!nextRequest) {
        return response;
      }
      await response.body?.cancel().catch((): undefined => undefined);
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error("Service redirect limit exceeded");
      }
      request = nextRequest;
    }
  };
}
