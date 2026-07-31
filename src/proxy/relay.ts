import {
  ALLOWED_PROXY_METHODS,
  MAX_PROXY_REDIRECTS,
  MAX_PROXY_REQUEST_BYTES,
  MAX_PROXY_RESPONSE_BYTES,
  PROXY_TIMEOUT_MS,
  type ProxyServerConfig,
} from "./config.ts";
import {
  decodeBody,
  encodeBody,
  headersFromPairs,
  headersToPairs,
  isProxyRequestEnvelope,
  type ProxyRequestEnvelope,
  type ProxyResponseEnvelope,
} from "./protocol.ts";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class ProxyRelayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProxyRelayError";
    this.code = code;
    this.status = status;
  }
}

export type ProxyLogger = Pick<Console, "info" | "error">;

export type RelayDependencies = {
  fetchImpl?: typeof fetch;
  requestId: string;
  logger?: ProxyLogger;
  timeoutMs?: number;
};

function validateTarget(rawUrl: string, allowedHosts: Set<string>): URL {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new ProxyRelayError("INVALID_REQUEST", 400, "Target URL is invalid");
  }

  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    !allowedHosts.has(target.hostname.toLowerCase()) ||
    (target.port !== "" && target.port !== "443")
  ) {
    throw new ProxyRelayError(
      "FORBIDDEN_DESTINATION",
      403,
      "Target destination is not allowed",
    );
  }
  return target;
}

function safeHeaders(pairs: ProxyRequestEnvelope["headers"]): Headers {
  let headers: Headers;
  try {
    headers = headersFromPairs(pairs);
  } catch {
    throw new ProxyRelayError(
      "INVALID_REQUEST",
      400,
      "Request headers are invalid",
    );
  }
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }
  return headers;
}

function safeResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    filtered.delete(name);
  }
  return filtered;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    byteLength += value.byteLength;
    if (byteLength > MAX_PROXY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProxyRelayError(
        "RESPONSE_TOO_LARGE",
        502,
        "Upstream response exceeded the proxy limit",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function logFailure(
  logger: ProxyLogger,
  requestId: string,
  target: URL,
  method: string,
  startedAt: number,
  requestBytes: number,
  errorCode: string,
): void {
  logger.error("service-proxy", {
    requestId,
    method,
    host: target.hostname,
    path: target.pathname,
    durationMs: Date.now() - startedAt,
    requestBytes,
    errorCode,
  });
}

export async function executeProxyRequest(
  envelope: ProxyRequestEnvelope,
  config: ProxyServerConfig,
  {
    fetchImpl = globalThis.fetch,
    requestId,
    logger = console,
    timeoutMs = PROXY_TIMEOUT_MS,
  }: RelayDependencies,
): Promise<ProxyResponseEnvelope> {
  if (!isProxyRequestEnvelope(envelope)) {
    throw new ProxyRelayError(
      "INVALID_REQUEST",
      400,
      "Request envelope is invalid",
    );
  }

  let method = envelope.method.toUpperCase();
  if (!ALLOWED_PROXY_METHODS.has(method)) {
    throw new ProxyRelayError(
      "FORBIDDEN_METHOD",
      403,
      "Target method is not allowed",
    );
  }

  let target = validateTarget(envelope.url, config.allowedHosts);
  let headers = safeHeaders(envelope.headers);
  let body = envelope.bodyBase64
    ? decodeBody(envelope.bodyBase64)
    : new Uint8Array();
  if (body.byteLength > MAX_PROXY_REQUEST_BYTES) {
    throw new ProxyRelayError(
      "REQUEST_TOO_LARGE",
      413,
      "Upstream request body exceeded the proxy limit",
    );
  }
  if ((method === "GET" || method === "HEAD") && body.byteLength > 0) {
    throw new ProxyRelayError(
      "INVALID_REQUEST",
      400,
      `${method} requests cannot contain a body`,
    );
  }

  const startedAt = Date.now();
  const requestBytes = body.byteLength;
  let redirectNumber = 0;

  try {
    while (true) {
      const response = await fetchImpl(target, {
        method,
        headers,
        body:
          method === "GET" || method === "HEAD" || body.byteLength === 0
            ? undefined
            : Buffer.from(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location) {
        if (redirectNumber >= MAX_PROXY_REDIRECTS) {
          throw new ProxyRelayError(
            "TOO_MANY_REDIRECTS",
            502,
            "Upstream exceeded the redirect limit",
          );
        }

        const nextTarget = validateTarget(
          new URL(location, target).toString(),
          config.allowedHosts,
        );
        redirectNumber += 1;
        if (config.debug) {
          logger.info("service-proxy-redirect", {
            requestId,
            method,
            host: nextTarget.hostname,
            path: nextTarget.pathname,
            redirectStatus: response.status,
            redirectNumber,
          });
        }
        await response.body?.cancel();

        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method === "POST")
        ) {
          method = "GET";
          body = new Uint8Array();
          headers = new Headers(headers);
          headers.delete("content-type");
          headers.delete("content-length");
        }
        target = nextTarget;
        continue;
      }

      const responseBody = await readBoundedBody(response);
      logger.info("service-proxy", {
        requestId,
        method,
        host: target.hostname,
        path: target.pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestBytes,
        responseBytes: responseBody.byteLength,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: headersToPairs(safeResponseHeaders(response.headers)),
        url: target.toString(),
        bodyBase64: encodeBody(responseBody),
        requestId,
      };
    }
  } catch (error) {
    if (error instanceof ProxyRelayError) {
      logFailure(
        logger,
        requestId,
        target,
        method,
        startedAt,
        requestBytes,
        error.code,
      );
      throw error;
    }
    const relayError = isAbortError(error)
      ? new ProxyRelayError(
          "UPSTREAM_TIMEOUT",
          504,
          "Upstream request timed out",
        )
      : new ProxyRelayError(
          "UPSTREAM_FAILURE",
          502,
          "Upstream request failed",
        );
    logFailure(
      logger,
      requestId,
      target,
      method,
      startedAt,
      requestBytes,
      relayError.code,
    );
    throw relayError;
  }
}
