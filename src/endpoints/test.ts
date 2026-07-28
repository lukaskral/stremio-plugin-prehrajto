import { createHash, timingSafeEqual } from "node:crypto";

import { type Request, type Response } from "express";

import { parseProxyQueryConfig } from "../proxy/config.ts";
import type { OuterRequest } from "../proxy/serviceFetch.ts";
import type { ProxyEndpointPolicyDependencies } from "../proxy/targetPolicy.ts";
import { getResolver } from "../service/prehrajto.ts";

const NL = "\r\n\r\n";
const PRIVATE_TEXT_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
  "Referrer-Policy": "no-referrer",
};

type TestHandlerDependencies = {
  fetchImpl?: typeof fetch;
  outerRequest?: OuterRequest;
  proxyPolicy?: ProxyEndpointPolicyDependencies;
};

function sendText(
  res: Response,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { ...PRIVATE_TEXT_HEADERS, ...headers });
  res.end(body);
}

function isAuthorized(header: string | string[] | undefined, token: string) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }

  const suppliedDigest = createHash("sha256")
    .update(header.slice("Bearer ".length))
    .digest();
  const expectedDigest = createHash("sha256").update(token).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function createTestHandler({
  fetchImpl = globalThis.fetch,
  outerRequest,
  proxyPolicy,
}: TestHandlerDependencies = {}) {
  return async function test(req: Request, res: Response) {
    const endpointToken = process.env.TEST_ENDPOINT_BEARER_TOKEN;
    if (!endpointToken) {
      sendText(res, 503, "Diagnostic endpoint is not configured" + NL);
      return;
    }

    if (!isAuthorized(req.headers.authorization, endpointToken)) {
      sendText(res, 401, "Unauthorized" + NL, {
        "WWW-Authenticate": "Bearer",
      });
      return;
    }

    const userName = process.env.PREHRAJTO_DEBUG_USERNAME;
    const password = process.env.PREHRAJTO_DEBUG_PASSWORD;
    if (!userName || !password) {
      sendText(res, 503, "Diagnostic credentials are not configured" + NL);
      return;
    }

    let url: URL;
    try {
      url = new URL(req.protocol + "://" + req.hostname + req.url);
    } catch {
      sendText(res, 400, "Invalid diagnostic request" + NL);
      return;
    }

    let proxyConfig;
    try {
      proxyConfig = await parseProxyQueryConfig(url.searchParams, proxyPolicy);
    } catch {
      sendText(res, 400, "Invalid proxy configuration" + NL);
      return;
    }

    try {
      const term = url.searchParams.get("q");
      const breakpoint = url.searchParams.get("breakpoint");
      const addonConfig = {
        prehrajtoUsername: userName,
        prehrajtoPassword: password,
      };
      const resolver = getResolver(fetchImpl, {
        outerRequest,
        transportConfig: proxyConfig,
      });
      const initialized = await resolver.init();
      const validated = await resolver.validateConfig(addonConfig);
      const debugInfo = resolver.debug
        ? await resolver.debug(addonConfig)
        : null;
      let output =
        JSON.stringify({ initialized, validated, debugInfo }, null, 4) + NL;

      if (breakpoint === "0") {
        sendText(res, 200, output + "Breakpoint 0");
        return;
      }

      const results = await resolver.search(
        term || "harry potter a kámen mudrců",
        addonConfig,
      );

      output += "Results: " + results.length + NL;

      if (results.length === 0) {
        sendText(res, 200, output + "No results found");
        return;
      }

      const searchResult = results[0];
      output +=
        `/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(searchResult.resolverId)}?config=${encodeURIComponent(JSON.stringify({}))}` +
        NL;

      if (breakpoint === "1") {
        sendText(res, 200, output + "Breakpoint 1");
        return;
      }

      const first = await resolver.resolve(results[0].resolverId, addonConfig);
      const videoUrl = first.video;

      output += "Video URL resolved" + NL;
      if (breakpoint === "2") {
        sendText(res, 200, output + "Breakpoint 2");
        return;
      }

      const response = await fetchImpl(videoUrl, {
        headers: {
          Range: "bytes=0-1023",
        },
      });

      if (response.status >= 400) {
        sendText(res, 200, output + "Response: " + response.status);
        return;
      }

      sendText(res, 200, output + "OK: " + response.status);
    } catch {
      sendText(res, 502, "Diagnostic request failed" + NL);
    }
  };
}

export default createTestHandler();
