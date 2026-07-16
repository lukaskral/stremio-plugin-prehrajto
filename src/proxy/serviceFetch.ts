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
  if (!config) {
    return fetchImpl;
  }

  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const bodyBase64 =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : encodeBody(await request.clone().arrayBuffer());
    const envelope: ProxyRequestEnvelope = {
      url: request.url,
      method: request.method,
      headers: headersToPairs(request.headers),
      ...(bodyBase64 ? { bodyBase64 } : {}),
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
        throw new Error(
          `Service proxy ${payload.error.code} (${payload.error.requestId}): ${payload.error.message}`,
        );
      }
      throw new Error(`Service proxy returned HTTP ${relayResponse.status}`);
    }
    if (!isProxyResponseEnvelope(payload)) {
      throw new Error("Service proxy returned a malformed response");
    }

    return new Response(Buffer.from(decodeBody(payload.bodyBase64)), {
      status: payload.status,
      statusText: payload.statusText,
      headers: headersFromPairs(payload.headers),
    });
  };
}

export const serviceFetch = createServiceFetch();
