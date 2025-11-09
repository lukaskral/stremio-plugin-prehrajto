import CryptoJS from "crypto-js";
import { parseHTML } from "linkedom";

import type { SearchResult, StreamDetails } from "../getTopItems.ts";
import type { Resolver } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  Referer: "https://sosac.tv/",
};

async function getSearchResults(title: string, fetchOptions: FetchOptions = {}) {
  const q = encodeURIComponent(title);
  const url = `https://sosac.tv/search/?q=${q}`;
  const res = await fetch(url, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const html = await res.text();
  const { document } = parseHTML(html);

  const items = document.querySelectorAll(".video, .item, article, .search-result");
  const results: SearchResult[] = [...items]
    .map((el) => {
      const a = el.querySelector("a[href]") || el.querySelector("a.video-link");
      const path = a ? a.getAttribute("href") : null;
      const titleAttr = (a ? a.getAttribute("title") || a.textContent : null) || el.querySelector("h3")?.textContent || "";

      const durationStr = el.querySelector(".duration, .time")?.textContent?.trim() || "0:00";
      const sizeEl = el.querySelector(".size, .video-size");
      const sizeStr = (sizeEl && sizeEl.textContent && sizeEl.textContent.trim().toUpperCase()) || "";

      return {
        resolverId: path || "",
        title: titleAttr.trim(),
        detailPageUrl: path ? `https://sosac.tv${path}` : "",
        duration: timeToSeconds(durationStr),
        size: sizeStr ? sizeToBytes(sizeStr) : 0,
      } as SearchResult;
    })
    .filter((r) => r.resolverId);

  return results;
}

async function getResultStreamUrls(resolverId: string, fetchOptions: FetchOptions = {}): Promise<StreamDetails> {
  const detailPageUrl = resolverId.startsWith("http") ? resolverId : `https://sosac.tv${resolverId}`;
  const pageResponse = await fetch(detailPageUrl, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  let video = "";
  const subtitles: { id: string; url: string; lang: string }[] = [];

  // 1) try <video> or <source>
  const videoEl = document.querySelector("video[src]") as Element | null;
  const sourceEl = document.querySelector("video source[src]") as Element | null;
  if (videoEl) {
    const src = videoEl.getAttribute("src") || videoEl.getAttribute("data-src");
    if (src) video = src;
  } else if (sourceEl) {
    const src = sourceEl.getAttribute("src") || sourceEl.getAttribute("data-src");
    if (src) video = src;
  }

  if (!video) {
    // 2) look into scripts for common patterns
    const scriptEls = document.querySelectorAll("script");
    const scripts = [...scriptEls].map((s) => s.textContent).filter(Boolean) as string[];

    for (const script of scripts) {
      try {
        // sources array like var sources = [ { file: '...' } ]
        if (script.includes("sources") && /var\s+sources\s*=/.test(script)) {
          const m = /var\s+sources\s*=\s*(\[.*?\])\s*;/.exec(script);
          if (m) {
            // eslint-disable-next-line no-eval
            const items = eval(m[1]);
            if (Array.isArray(items) && items.length) {
              const last = items[items.length - 1];
              video = last.file || last.src || last.url || "";
              if (video) break;
            }
          }
        }

        // file: 'https://...'
        const fileMatch = /file\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(script);
        if (fileMatch && fileMatch[1]) {
          video = fileMatch[1];
          break;
        }

        // src: 'https://...'
        const srcMatch = /src\s*[:=]\s*["'](https?:\/\/[^"']+)["']/.exec(script);
        if (srcMatch && srcMatch[1]) {
          video = srcMatch[1];
          break;
        }
      } catch (e) {
        // ignore script parse errors
      }
    }
  }

  // 3) try encrypted payloads if present
  if (!video) {
    const encMatch = pageHtml.match(/data-enc=["']([A-Za-z0-9+\/=\n\r]+)["']/);
    if (encMatch) {
      try {
        const keyMatch = pageHtml.match(/data-key=["']([^"']+)["']/) || pageHtml.match(/var\s+key\s*=\s*'([^']+)'/);
        if (keyMatch) {
          const ct = encMatch[1];
          const key = keyMatch[1];
          const bytes = CryptoJS.AES.decrypt(ct, key);
          const decrypted = bytes.toString(CryptoJS.enc.Utf8);
          const urlMatch = decrypted && decrypted.match(/https?:\/\/[^\s'\"]+/);
          if (urlMatch) video = urlMatch[0];
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // subtitles from <track>
  const trackEls = document.querySelectorAll("track[src]");
  for (const t of trackEls) {
    const url = t.getAttribute("src") || "";
    subtitles.push({ id: t.getAttribute("label") || t.getAttribute("srclang") || "sub", url, lang: t.getAttribute("srclang") || "" });
  }

  return { video, subtitles };
}

export function getResolver(): Resolver {
  return {
    resolverName: "Sosac",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title, addonConfig) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.log("sosac search error", e);
        return [];
      }
    },

    resolve: async (resolverId, addonConfig) => {
      try {
        return await getResultStreamUrls(resolverId);
      } catch (e) {
        console.log("sosac resolve error", e);
        return { video: "" };
      }
    },
  };
}



import CryptoJS from "crypto-js";
import { parseHTML } from "linkedom";

import type { SearchResult, StreamDetails } from "../getTopItems.ts";
import type { Resolver } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  Referer: "https://sosac.tv/",
};

async function getSearchResults(title: string, fetchOptions: FetchOptions = {}) {
  const q = encodeURIComponent(title);
  const url = `https://sosac.tv/search/?q=${q}`;
  const res = await fetch(url, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const html = await res.text();
  const { document } = parseHTML(html);

  // sosac search results: articles or .item blocks
  const items = document.querySelectorAll(".video, .item, article, .search-result");
  const results: SearchResult[] = [...items].map((el) => {
    // try to find anchor
    const a = el.querySelector("a[href]") || el.querySelector("a.video-link");
    const path = a ? a.getAttribute("href") : null;
  const titleAttr = a ? a.getAttribute("title") || a.textContent : el.querySelector("h3")?.textContent || "";

    const durationStr = el.querySelector(".duration, .time")?.textContent?.trim() || "0:00";
    const sizeStr = el.querySelector(".size, .video-size")?.textContent?.trim()?.toUpperCase() || "";

    return {
      resolverId: path || "",
      title: titleAttr?.trim(),
      detailPageUrl: path ? `https://sosac.tv${path}` : "",
      duration: timeToSeconds(durationStr),
      size: sizeStr ? sizeToBytes(sizeStr) : 0,
    };
  }).filter(r => r.resolverId);

  return results;
}

async function getResultStreamUrls(resolverId: string, fetchOptions: FetchOptions = {}): Promise<StreamDetails> {
  const detailPageUrl = resolverId.startsWith("http") ? resolverId : `https://sosac.tv${resolverId}`;
  const pageResponse = await fetch(detailPageUrl, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  // Try to find common player script containing sources or video tag
  let video = "";
  const subtitles: { id: string; url: string; lang: string }[] = [];

  // 1) <video> tag
  const videoEl = document.querySelector("video[src]") || document.querySelector("video source[src]");
        if (!video) {
          const m2 = /file\s*:\s*["'](https?:\/\/[^"']+)["']/s.exec(script) as RegExpExecArray | null;
          if (m2 && m2[1]) {
            video = m2[1];
          }
        }
        if (!video) {
          const srcMatch = /src\s*[:=]\s*["'](https?:\/\/[^"']+)["']/s.exec(script) as RegExpExecArray | null;
          if (srcMatch && srcMatch[1]) video = srcMatch[1];
        }
  if (!video) {
    const scriptEls = document.querySelectorAll("script");
    const scripts = [...scriptEls].map(s => s.textContent).filter(Boolean);
    for (const script of scripts) {
      try {
        if (script.includes("sources") && /var\s+sources\s*=/.test(script)) {
          const m = /var\s+sources\s*=\s*(\[.*?\])\s*;/s.exec(script);
          if (m) {
            // eslint-disable-next-line no-eval
            const items = eval(m[1]);
            if (Array.isArray(items) && items.length) {
              const last = items[items.length - 1];
              video = last.file || last.src || last.url || "";
            }
          }
        }
        if (!video) {
          const m2 = /file\s*:\s*"(https?:\\/\\/[^\"]+)"/s.exec(script) || /file\s*:\s*'(https?:\\/\\/[^']+)'/s.exec(script);
          if (m2) {
            video = m2[1].replace(/\\/g, "");
          }
        }
        if (!video) {
          const srcMatch = /src\s*[:=]\s*"(https?:\\/\\/[^\"]+)"/s.exec(script) || /src\s*[:=]\s*'(https?:\\/\\/[^']+)'/s.exec(script);
          if (srcMatch) video = srcMatch[1].replace(/\\/g, "");
        }
        if (video) break;
      } catch (e) {
        // ignore eval errors
      }
    }
  }

  // 3) encrypted payloads (Sosac might use simple AES obfuscation) - try to find encrypted string and key
  if (!video) {
    const encMatch = pageHtml.match(/data\-enc=["']([A-Za-z0-9+/=\n\r]+)["']/);
    if (encMatch) {
      try {
        // if there's a key variable on page
        const keyMatch = pageHtml.match(/data\-key=["']([^"']+)["']/) || pageHtml.match(/var\s+key\s*=\s*'([^']+)'/);
        if (keyMatch) {
          const ct = encMatch[1];
          const key = keyMatch[1];
          const bytes = CryptoJS.AES.decrypt(ct, key);
          const decrypted = bytes.toString(CryptoJS.enc.Utf8);
          const urlMatch = decrypted && decrypted.match(/https?:\/\/[^\s'\"]+/);
          if (urlMatch) video = urlMatch[0];
        }
      } catch (e) {
        // ignore
      }
    }
  }

  return { video, subtitles };
}

export function getResolver(): Resolver {
  return {
    resolverName: "Sosac",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title, addonConfig) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.log("sosac search error", e);
        return [];
      }
    },

    resolve: async (resolverId, addonConfig) => {
      try {
        return await getResultStreamUrls(resolverId);
      } catch (e) {
        console.log("sosac resolve error", e);
        return { video: "" };
      }
    },
  };
}
