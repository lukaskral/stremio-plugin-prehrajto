import CryptoJS from "crypto-js";
import { parseHTML } from "linkedom";

import type { SearchResult, StreamDetails } from "../getTopItems.ts";
import type { Resolver } from "../getTopItems.ts";
import { sizeToBytes } from "../utils/convert.ts";
import commonHeaders from "../utils/headers.ts";
import { md5crypt } from "../utils/webshareCrypto.ts";

const headers = {
  ...commonHeaders,
  accept: "application/xml",
  Referer: "https://webshare.cz/",
};

async function getSalt(userName: string) {
  const pageResponse = await fetch("https://webshare.cz/api/salt/", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `username_or_email=${encodeURIComponent(userName)}`,
    method: "POST",
  });
  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const statusEl = document.querySelector("status");
  const saltEl = document.querySelector("salt");
  const salt: string = saltEl?.innerHTML;

  if (statusEl.innerHTML !== "OK" || !salt) {
    return "";
  }
  return salt;
}

async function login(userName: string, password: string) {
  const salt = await getSalt(userName);
  const hash = CryptoJS.SHA1(md5crypt(password, salt)).toString();
  const pageResponse = await fetch("https://webshare.cz/api/login/", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `username_or_email=${encodeURIComponent(userName)}&password=${encodeURIComponent(
      hash,
    )}&keep_logged_in=1`,
    method: "POST",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const statusEl = document.querySelector("status");
  const tokenEl = document.querySelector("token");
  const wst = tokenEl?.innerHTML;

  if (statusEl.innerHTML !== "OK" || !wst) {
    return {};
  }
  return { wst };
}

const tokensCache = new Map();

async function getTokens(userName: string, password: string) {
  const cacheKey = `${userName}:${password}`;
  const tokens = tokensCache.get(cacheKey);
  if (tokens) {
    return tokens;
  }

  const newTokens = await login(userName, password);
  tokensCache.set(cacheKey, newTokens);
  return newTokens;
}

async function getResultStreamUrls(
  result: SearchResult,
  tokens: Record<string, string>,
): Promise<StreamDetails> {
  const pageResponse = await fetch("https://webshare.cz/api/file_link/", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `ident=${result.resolverId}&category=video&wst=${tokens.wst}`,
    method: "POST",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  const statusEl = document.querySelector("status");
  let video = "";

  try {
    const linkRegex = /<link>(.*)<\/link>/s;
    const linkContent = linkRegex.exec(pageHtml)?.[1];
    video = linkContent;
  } catch (error) {
    console.log("error parsing streams", error);
  }

  if (statusEl.innerHTML !== "OK" || !video) {
    throw new Error("Response failed");
  }

  return { video };
}

async function getSearchResults(
  title: string,
  tokens: Record<string, string>,
): Promise<SearchResult[]> {
  const pageResponse = await fetch("https://webshare.cz/api/search/", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `what=${encodeURIComponent(title)}&category=video&wst=${tokens.wst}`,
    method: "POST",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const files = document.querySelectorAll("file");
  const results = [...files].map((fileEl): SearchResult | null => {
    const sizeStr = fileEl.querySelector("size").innerHTML.toUpperCase();
    const id = fileEl.querySelector("ident").innerHTML;

    if (fileEl.querySelector("password").innerHTML !== "0") {
      return null;
    }

    return {
      detailPageUrl: `https://webshare.cz/#/file/${id}/`,
      duration: undefined,
      resolverId: id,
      title: fileEl.querySelector("name").innerHTML,
      format: fileEl.querySelector("type").innerHTML, // TODO
      size: sizeToBytes(sizeStr),
    };
  });
  return results;
}

export function getResolver(): Resolver {
  return {
    resolverName: "WebShare",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async (addonConfig) => {
      if (!addonConfig.webshareUsername || !addonConfig.websharePassword) {
        return false;
      }
      const tokens = await getTokens(
        addonConfig.webshareUsername,
        addonConfig.websharePassword,
      );

      return "wst" in tokens;
    },

    search: async (title, addonConfig) => {
      const fetchOptions = await getTokens(
        addonConfig.webshareUsername,
        addonConfig.websharePassword,
      );
      return getSearchResults(title, fetchOptions);
    },

    resolve: async (searchResult, addonConfig) => {
      const fetchOptions = await getTokens(
        addonConfig.webshareUsername,
        addonConfig.websharePassword,
      );
      return {
        ...searchResult,
        ...(await getResultStreamUrls(searchResult, fetchOptions)),
      };
    },
  };
}
