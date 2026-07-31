import { parseHTML } from "linkedom";
import type { HTMLElement } from "linkedom/types/index.js";

import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import headers, { type FetchOptions } from "../utils/headers.ts";

function getSearchToken() {
  const token =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  return token;
}

async function getResultStreamUrls(
  resolverId: string,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const detailPageUrl = resolverId;
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

  const videoSources = (
    document.querySelectorAll("video source") as HTMLElement[]
  )
    ?.map((sourceEl: HTMLElement) => ({
      src: sourceEl.getAttribute("src"),
      width: parseInt(sourceEl.getAttribute("width")),
    }))
    .sort((a, b) => b.width - a.width);

  if (!videoSources[0].src) {
    throw new Error("No video found");
  }

  return {
    title: document
      .querySelector("meta[name=description]")
      ?.getAttribute("content")
      .replace(/online ke zhlédnutí a stažení/, "")
      .trim(),
    detailPageUrl,
    video:
      videoSources[0].src ??
      `https://fastshare.cloud${document
        .querySelector("form#form")
        .getAttribute("action")}`,
    subtitles: [],
  };
}

async function getSearchResults(
  title: string,
  fetchOptions: FetchOptions = {},
): Promise<SearchResult[]> {
  const pageResponse = await fetch(
    `https://fastshare.cloud/${encodeURIComponent(title)}/s`,
    {
      ...fetchOptions,
      headers: {
        ...headers,
        ...(fetchOptions.headers ?? {}),
      },
      method: "GET",
    },
  );
  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const tokenEl = document.getElementById("search_token");
  const token = tokenEl.getAttribute("value") ?? getSearchToken();

  const results = (
    await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map((page) =>
        getPageSearchResults(title, page, token, fetchOptions),
      ),
    )
  ).flat();
  return results;
}

async function getPageSearchResults(
  title: string,
  page: number,
  searchToken: string,
  fetchOptions: FetchOptions = {},
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    token: searchToken,
    u: "",
    term: Buffer.from(title).toString("base64"),
    search_purpose: "0",
    search_resolution: "0",
    plain_search: "0",
    limit: String(1 + page * 9),
    order: "3",
    type: "video",
    step: "3",
  });
  const pageResponse = await fetch(
    `https://fastshare.cloud/test2.php?${params}`,
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
  const pageHtml = `<html><ul>${await pageResponse.text()}</ul></html>`;
  const { document } = parseHTML(pageHtml);
  const items = document.querySelectorAll("html ul > li");
  const results = [...items]
    .flatMap((listEl) => {
      const detailEl = listEl.querySelector(".video_detail");
      if (!detailEl) {
        return [];
      }
      const linkEl = detailEl.querySelector("a");
      const sizeStr = detailEl.querySelector(".pull-right").innerHTML;

      return [
        {
          resolverId: linkEl.getAttribute("href"),
          title: linkEl.innerText,
          detailPageUrl: linkEl.getAttribute("href"),
          duration: timeToSeconds(
            [...detailEl.querySelectorAll(".video_time")][0].innerText.trim(),
          ),
          format: [
            ...detailEl.querySelectorAll(".video_time"),
          ][1].innerText.trim(),
          size: sizeToBytes(sizeStr),
          playable: Boolean(listEl.querySelector(".playable")),
          order: page ? "0" : "",
        },
      ];
    })
    .filter((item) => item?.playable);

  return results;
}

export function getResolver(): Resolver {
  const fetchOptions = {};
  return {
    resolverName: "Fastshare",

    init: () => {
      /**
       * This resolver works fine but the stream fails when you try to seek in the video.
       * It's disabled for now
       */
      return false;
    },
    getConfigFields: () => [],
    validateConfig: async () => true,
    search: (title) => {
      return getSearchResults(title, fetchOptions);
    },
    resolve: async (resolverId) =>
      getResultStreamUrls(resolverId, fetchOptions),
  };
}
