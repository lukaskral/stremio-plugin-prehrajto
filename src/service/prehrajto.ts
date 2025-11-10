import { parseHTML } from "linkedom";

import type { Resolver, StreamDetails } from "../getTopItems.ts";
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

/**
 * Get headers for authenticated response
 */
async function login(userName: string, password: string) {
  const anonymousOptions = await loginAnonymous();
  if (!userName) {
    return anonymousOptions;
  }
  const formData = new FormData();
  formData.set("email", userName);
  formData.set("password", password);
  formData.set("remember_login", "on");
  formData.set("_do", "loginDialog-login-loginForm-submit");
  formData.set("login", "Přihlásit se");

  const r1 = await fetch(
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

  const cookies = extractCookies(r1);
  if (!cookies.some((c) => c.name === "access_token")) {
    return {};
  }

  return {
    headers: headerCookies(cookies),
  };
}

async function loginAnonymous() {
  const result = await fetch("https://prehraj.to/", {
    headers: {
      ...headers,
      Referer: "https://prehraj.to/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    method: "GET",
  });

  const cookies = extractCookies(result);

  return {
    headers: headerCookies(cookies),
  };
}

const fetchOptionsCache = new Map<
  string,
  { created: number; options: Record<string, unknown> }
>();
/**
 * Get headers for authenticated response
 */
async function getFetchOptions(userName: string, password: string) {
  const cacheKey = `${userName}:${password}`;
  const fetchCache = fetchOptionsCache.get(cacheKey);
  if (fetchCache) {
    if (fetchCache.created && fetchCache.created > Date.now() - 8_400_000) {
      return fetchCache.options;
    } else {
      fetchOptionsCache.delete(cacheKey);
    }
  }

  const newFetchOptions = await login(userName, password);
  fetchOptionsCache.set(cacheKey, {
    created: Date.now(),
    options: newFetchOptions,
  });
  return newFetchOptions;
}

async function getResultStreamUrls(
  resolverId: string,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const detailPageUrl = `https://prehraj.to${resolverId}`;
  const pageResponse = await fetch(detailPageUrl, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    body: null,
    method: "GET",
  });
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
  fetchOptions: FetchOptions = {},
) {
  const pageResponse = await fetch(
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
      format: linkEl
        .querySelector(".video__tag--format use")
        ?.getAttribute("xlink:href"), // TODO
      size: sizeToBytes(sizeStr),
    };
  });
  return results;
}

export function getResolver(): Resolver {
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
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return "headers" in fetchOptions;
    },

    search: async (title, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return getSearchResults(title, fetchOptions);
    },

    resolve: async (resolverId, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return getResultStreamUrls(resolverId, fetchOptions);
    },

    cleanup: async () => {
      fetchOptionsCache.clear();
    },

    debug: () => {
      return Object.fromEntries(fetchOptionsCache);
    },
  };
}
