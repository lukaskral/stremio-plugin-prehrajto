import { AsyncLocalStorage } from "node:async_hooks";
import {
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";

import proxyaddr from "proxy-addr";

export type TrustProxy = ReturnType<typeof proxyaddr.compile>;

const serverOrigin = new AsyncLocalStorage<string>();

export function createTrustProxy(
  value: string | undefined,
): TrustProxy | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries && entries.length > 0
    ? proxyaddr.compile(entries)
    : undefined;
}

function readSingleHeader(
  request: IncomingMessage,
  name: "host" | "x-forwarded-host" | "x-forwarded-proto",
): string | undefined {
  const value = request.headers[name];
  const displayName = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("-");

  if (value === undefined) return undefined;
  if (Array.isArray(value) || value.includes(",")) {
    throw new Error(`${displayName} must contain exactly one value`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function connectionProtocol(request: IncomingMessage): "http" | "https" {
  const socket = request.socket as typeof request.socket & {
    encrypted?: boolean;
  };
  return socket.encrypted === true ? "https" : "http";
}

export function getRequestOrigin(
  request: IncomingMessage,
  trustProxy?: TrustProxy,
): string {
  const remoteAddress = request.socket.remoteAddress;
  const isTrustedProxy =
    remoteAddress !== undefined && trustProxy?.(remoteAddress, 0) === true;
  const forwardedHost = isTrustedProxy
    ? readSingleHeader(request, "x-forwarded-host")
    : undefined;
  const forwardedProto = isTrustedProxy
    ? readSingleHeader(request, "x-forwarded-proto")
    : undefined;
  const host = forwardedHost ?? readSingleHeader(request, "host");
  const protocol = (
    forwardedProto ?? connectionProtocol(request)
  ).toLowerCase();

  if (!host) throw new Error("Request Host header is required");
  if (protocol !== "http" && protocol !== "https") {
    throw new Error("Request protocol must be http or https");
  }

  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    throw new Error("Request origin is invalid");
  }

  if (origin.username || origin.password) {
    throw new Error("Request origin must not contain credentials");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(
      "Request origin must not contain a path, query, or fragment",
    );
  }

  return origin.origin;
}

export function runWithServerOrigin<T>(origin: string, callback: () => T): T {
  return serverOrigin.run(origin, callback);
}

export function getServerOrigin(): string {
  const origin = serverOrigin.getStore();
  if (!origin) {
    throw new Error("Server origin is unavailable outside an HTTP request");
  }
  return origin;
}

type LogOriginError = (message: string, error: unknown) => void;

export function installServerOriginContext(
  server: Server,
  trustProxy?: TrustProxy,
  logError: LogOriginError = console.error,
): void {
  const originalListeners = server.listeners("request") as RequestListener[];
  server.removeAllListeners("request");

  server.on("request", (request, response) => {
    let origin: string;
    try {
      origin = getRequestOrigin(request, trustProxy);
    } catch (error) {
      logError("Invalid request origin:", error);
      response.writeHead(400, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Invalid request origin\r\n\r\n");
      return;
    }

    runWithServerOrigin(origin, () => {
      for (const listener of originalListeners) {
        listener.call(server, request, response);
      }
    });
  });
}
