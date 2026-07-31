import { randomUUID, timingSafeEqual } from "node:crypto";

import { type Request, type Response } from "express";

import {
  type Environment,
  getProxyServerConfig,
  MAX_PROXY_ENVELOPE_BYTES,
} from "../proxy/config.ts";
import {
  isProxyRequestEnvelope,
  type ProxyErrorEnvelope,
} from "../proxy/protocol.ts";
import {
  executeProxyRequest,
  type ProxyLogger,
  ProxyRelayError,
} from "../proxy/relay.ts";

export type ServiceProxyHandlerDependencies = {
  env?: Environment;
  fetchImpl?: typeof fetch;
  logger?: ProxyLogger;
  createRequestId?: () => string;
};

class EndpointError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function sendJson(res: Response, status: number, body: unknown): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId: string,
): void {
  const body: ProxyErrorEnvelope = {
    error: { code, message, requestId },
  };
  sendJson(res, status, body);
}

function hasValidToken(authorization: string | undefined, token: string): boolean {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readBody(req: Request): Promise<string> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_PROXY_ENVELOPE_BYTES) {
      throw new EndpointError(
        "REQUEST_TOO_LARGE",
        413,
        "Proxy request envelope exceeded the limit",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createServiceProxyHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  createRequestId = randomUUID,
}: ServiceProxyHandlerDependencies = {}): (
  req: Request,
  res: Response,
) => Promise<void> {
  return async (req, res) => {
    const requestId = createRequestId();
    let config;
    try {
      config = getProxyServerConfig(env);
    } catch {
      sendError(
        res,
        503,
        "PROXY_DISABLED",
        "Service proxy is not configured",
        requestId,
      );
      return;
    }

    if (req.method !== "POST") {
      sendError(
        res,
        405,
        "METHOD_NOT_ALLOWED",
        "Service proxy endpoint accepts POST requests only",
        requestId,
      );
      return;
    }

    if (!hasValidToken(req.headers.authorization, config.token)) {
      sendError(
        res,
        401,
        "UNAUTHORIZED",
        "Service proxy authentication failed",
        requestId,
      );
      return;
    }

    try {
      const rawBody = await readBody(req);
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new EndpointError(
          "INVALID_REQUEST",
          400,
          "Request body must be valid JSON",
        );
      }
      if (!isProxyRequestEnvelope(payload)) {
        throw new EndpointError(
          "INVALID_REQUEST",
          400,
          "Request envelope is invalid",
        );
      }

      const result = await executeProxyRequest(payload, config, {
        fetchImpl,
        requestId,
        logger,
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof ProxyRelayError || error instanceof EndpointError) {
        sendError(
          res,
          error.status,
          error.code,
          error.message,
          requestId,
        );
        return;
      }
      logger.error("service-proxy-endpoint", {
        requestId,
        errorCode: "INTERNAL_ERROR",
      });
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Service proxy failed unexpectedly",
        requestId,
      );
    }
  };
}

export default createServiceProxyHandler();
