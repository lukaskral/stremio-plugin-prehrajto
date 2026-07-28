import { createHash } from "node:crypto";

import { parseHTML } from "linkedom";

import type { Resolver, StreamDetails } from "../getTopItems.ts";
import { parseUserProxyConfig, type TransportConfig } from "../proxy/config.ts";
import {
  createServiceFetch,
  type OuterRequest,
} from "../proxy/serviceFetch.ts";
import type { ProxyEndpointPolicyDependencies } from "../proxy/targetPolicy.ts";
import type { UserConfigData } from "../userConfig/userConfig.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import { extractCookies, headerCookies } from "../utils/cookies.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  cookie: "AC=C",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "x-requested-with": "XMLHttpRequest",
  Referer: "https://prehraj.to/",
};

type PrehrajtoResolverDependencies = {
  proxyPolicy?: ProxyEndpointPolicyDependencies;
  outerRequest?: OuterRequest;
  transportConfig?: TransportConfig;
};

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Releasing a response body is best-effort and must not mask request errors.
  }
}

async function ensureSuccessfulResponse(response: Response, stage: string) {
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`PrehrajTo ${stage} request failed (${response.status})`);
  }
}

/**
 * Get headers for authenticated response
 */
async function login(
  userName: string,
  password: string,
  fetchImpl: typeof fetch,
) {
  const anonymousOptions = await loginAnonymous(fetchImpl);
  if (!userName) {
    return anonymousOptions;
  }
  const formData = new FormData();
  formData.set("email", userName);
  formData.set("password", password);
  formData.set("remember_login", "on");
  formData.set("_do", "loginDialog-login-loginForm-submit");
  formData.set("login", "Přihlásit se");

  const r1 = await fetchImpl(
    "https://prehraj.to/?frm=loginDialog-login-loginForm",
    {
      headers: {
        ...headers,
        ...anonymousOptions.headers,
        accept: "application/json",
      },
      body: formData,
      method: "POST",
    },
  );
  await ensureSuccessfulResponse(r1, "login");
  let cookies;
  try {
    cookies = extractCookies(r1);
  } finally {
    await cancelResponseBody(r1);
  }
  if (!cookies.some((c) => c.name === "access_token")) {
    return {
      _debug: "cookie not found",
      ...anonymousOptions,
    };
  }

  return {
    headers: headerCookies(cookies),
  };
}

async function loginAnonymous(fetchImpl: typeof fetch) {
  const result = await fetchImpl("https://prehraj.to/", {
    headers: {
      ...headers,
      Referer: "https://prehraj.to/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    method: "GET",
  });
  await ensureSuccessfulResponse(result, "session");
  let cookies;
  try {
    cookies = extractCookies(result);
  } finally {
    await cancelResponseBody(result);
  }

  return {
    headers: headerCookies(cookies),
  };
}

const fetchOptionsCache = new Map<
  string,
  { created: number; options: Record<string, unknown> }
>();
const AUTH_CACHE_MAX_AGE_MS = 8_400_000;
const MAX_AUTH_CACHE_ENTRIES = 64;

function lengthDelimited(values: string[]) {
  return values
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
    .join("");
}

function authCacheKey(
  userName: string,
  password: string,
  transportIdentity: string,
) {
  return createHash("sha256")
    .update(lengthDelimited([userName, password, transportIdentity]))
    .digest("hex");
}

function pruneFetchOptionsCache(now: number) {
  for (const [key, entry] of fetchOptionsCache) {
    if (entry.created <= now - AUTH_CACHE_MAX_AGE_MS) {
      fetchOptionsCache.delete(key);
    }
  }

  while (fetchOptionsCache.size >= MAX_AUTH_CACHE_ENTRIES) {
    const oldestKey = fetchOptionsCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    fetchOptionsCache.delete(oldestKey);
  }
}

/**
 * Get headers for authenticated response
 */
async function getFetchOptions(
  userName: string,
  password: string,
  fetchImpl: typeof fetch,
  transportIdentity: string,
) {
  const now = Date.now();
  pruneFetchOptionsCache(now);
  const cacheKey = authCacheKey(userName, password, transportIdentity);
  const fetchCache = fetchOptionsCache.get(cacheKey);
  if (fetchCache) {
    fetchOptionsCache.delete(cacheKey);
    fetchOptionsCache.set(cacheKey, fetchCache);
    return fetchCache.options;
  }

  const newFetchOptions = await login(userName, password, fetchImpl);
  fetchOptionsCache.set(cacheKey, {
    created: now,
    options: newFetchOptions,
  });
  return newFetchOptions;
}

async function getResultStreamUrls(
  resolverId: string,
  fetchImpl: typeof fetch,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const detailPageUrl = `https://prehraj.to${resolverId}`;
  const pageResponse = await fetchImpl(detailPageUrl, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    body: null,
    method: "GET",
  });
  await ensureSuccessfulResponse(pageResponse, "detail");
  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  const scriptEls = document.querySelectorAll("script");
  const scriptEl = [...scriptEls].find((el) =>
    el.textContent.includes("sources ="),
  );
  const script = scriptEl.textContent;

  let video = "";
  let subtitles: { id: string; url: string; lang: string }[] = [];

  try {
    const sourcesRegex = /.*var sources\s*=\s*(\[.*?\])\s*;/s;
    const sources = sourcesRegex.exec(script)[1];
    const items = eval(sources);
    video = items.pop().file;
  } catch (error) {
    console.log("error parsing streams", error);
    const srcRegex = /.*src:\s*"(.*?)".*/s;
    video = srcRegex.exec(script)[1];
  }

  try {
    const sourcesRegex = /.*var tracks\s*=\s*(\[.*?\])\s*;/s;
    const sources = sourcesRegex.exec(script)[1];
    const items = eval(sources) as Array<{
      kind: string;
      label: string;
      src: string;
      srclang: string;
    }>;
    subtitles = items
      .filter((item) => item.kind === "captions")
      .map((item) => ({
        id: item.label,
        url: item.src,
        lang: item.srclang,
      }));
  } catch {
    // nothing to do
  }

  return {
    video,
    subtitles,
  };
}

async function getSearchResults(
  title: string,
  fetchImpl: typeof fetch,
  fetchOptions: FetchOptions = {},
) {
  const pageResponse = await fetchImpl(
    `https://prehraj.to/hledej/${encodeURIComponent(title)}?vp-page=0`,
    {
      ...fetchOptions,
      headers: {
        ...headers,
        ...(fetchOptions.headers ?? {}),
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      body: null,
      method: "GET",
    },
  );
  await ensureSuccessfulResponse(pageResponse, "search");
  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const links = document.querySelectorAll("a.video--link");
  const results = [...links].map((linkEl) => {
    const path = linkEl.getAttribute("href");
    const sizeStr = linkEl
      .querySelector(".video__tag--size")
      .innerHTML.toUpperCase();

    return {
      resolverId: path,
      title: linkEl.getAttribute("title"),
      detailPageUrl: `https://prehraj.to${path}`,
      duration: timeToSeconds(
        linkEl.querySelector(".video__tag--time").innerHTML,
      ),
      format:
        linkEl
          .querySelector(".video__tag--format use")
          ?.getAttribute("xlink:href") ??
        linkEl
          .querySelector(".video__tag--format .format__text")
          ?.textContent.trim(),
      size: sizeToBytes(sizeStr),
    };
  });
  return results;
}

function transportIdentity(config: TransportConfig): string {
  if (config.mode === "direct") {
    return "transport:direct";
  }

  const proxyIdentity = lengthDelimited([config.endpoint.href, config.apiKey]);
  return `transport:proxy:${createHash("sha256").update(proxyIdentity).digest("hex")}`;
}

export function getResolver(
  fetchImpl: typeof fetch = globalThis.fetch,
  dependencies: PrehrajtoResolverDependencies = {},
): Resolver {
  async function createRequestContext(addonConfig: UserConfigData) {
    const config =
      dependencies.transportConfig ??
      (await parseUserProxyConfig(addonConfig, dependencies.proxyPolicy));
    return {
      fetchImpl: createServiceFetch({
        config,
        fetchImpl,
        outerRequest: dependencies.outerRequest,
      }),
      transportIdentity: transportIdentity(config),
    };
  }

  async function createAuthenticatedRequestContext(
    addonConfig: UserConfigData,
  ) {
    const requestContext = await createRequestContext(addonConfig);
    const fetchOptions = await getFetchOptions(
      addonConfig.prehrajtoUsername,
      addonConfig.prehrajtoPassword,
      requestContext.fetchImpl,
      requestContext.transportIdentity,
    );
    return { ...requestContext, fetchOptions };
  }

  return {
    resolverName: "PrehrajTo",

    init: () => true,

    getConfigFields: () => [
      {
        key: "prehrajtoUsername",
        type: "text" as const,
        title: "PrehrajTo username",
      },
      {
        key: "prehrajtoPassword",
        type: "password" as const,
        title: "PrehrajTo password",
      },
    ],

    validateConfig: async (addonConfig) => {
      if (!addonConfig.prehrajtoUsername || !addonConfig.prehrajtoPassword) {
        return false;
      }
      const requestContext =
        await createAuthenticatedRequestContext(addonConfig);
      return "headers" in requestContext.fetchOptions;
    },

    search: async (title, addonConfig) => {
      const requestContext =
        await createAuthenticatedRequestContext(addonConfig);
      return getSearchResults(
        title,
        requestContext.fetchImpl,
        requestContext.fetchOptions,
      );
    },

    resolve: async (resolverId, addonConfig) => {
      const requestContext =
        await createAuthenticatedRequestContext(addonConfig);
      return getResultStreamUrls(
        resolverId,
        requestContext.fetchImpl,
        requestContext.fetchOptions,
      );
    },

    cleanup: async () => {
      fetchOptionsCache.clear();
    },

    debug: async (addonConfig) => {
      const requestContext = await createRequestContext(addonConfig);
      const cacheKey = authCacheKey(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
        requestContext.transportIdentity,
      );
      const cache = fetchOptionsCache.get(cacheKey);
      const loginOptions = await login(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
        requestContext.fetchImpl,
      );
      return {
        cached: Boolean(cache),
        cacheCreated: cache?.created ?? null,
        authenticated: "headers" in loginOptions && !("_debug" in loginOptions),
      };
    },
  };
}
