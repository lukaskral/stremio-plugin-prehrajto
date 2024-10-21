const { parseHTML } = require("linkedom");
const { fetch } = require("undici");
const { timeToSeconds, sizeToBytes } = require("../utils/convert.js");
const { extractCookies, headerCookies } = require("../utils/cookies.js");
const { Storage } = require("../storage/Storage.js");
const XmlStream = require("xml-stream");
const Stream = require("stream");
const { isOlder } = require("../utils/isOlder.js");
const { is } = require("express/lib/request.js");

const headers = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.6",
  "cache-control": "max-age=0",
  priority: "u=0, i",
  "sec-ch-ua": '"Brave";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "sec-gpc": "1",
  "upgrade-insecure-requests": "1",
  cookie: "AC=C",
};

/**
 * Het headers for authenticated response
 * @param {string} userName
 * @param {string} password
 */
async function login(userName, password) {
  const result = await fetch("https://prehraj.to/", {
    headers: {
      ...headers,
      redirect: "manual",
      "content-type": "application/x-www-form-urlencoded",
      Referer: "https://prehraj.to/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    body: `email=${encodeURIComponent(userName)}&password=${encodeURIComponent(
      password,
    )}&remember=on&_submit=P%C5%99ihl%C3%A1sit+se&_do=login-loginForm-submit`,
    method: "POST",
  });

  const cookies = extractCookies(result);

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
/**
 * @typedef {import('../storage/Storage.js').StorageItem} StorageItem
 */

/**
 * @param {number} page
 * @param {(data: StorageItem) => void} onItem
 */
async function fetchSitemap(page = 1, onItem) {
  const response = await fetch(`https://prehraj.to/sitemap-${page}.to.xml`, {
    headers: {
      ...headers,
      accept: "application/xhtml+xml,application/xml",
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    body: null,
    method: "GET",
  });

  let isFetching = true;
  const readableStream = new Stream.Readable({
    read() {
      return isFetching;
    },
  });
  const textEncoder = new TextDecoder();
  const xml = new XmlStream(readableStream);
  let i = 0;
  xml.on("endElement: url", (item) => {
    const video = item["video:video"];
    i++;
    onItem({
      url: item["loc"],
      title: video["video:title"],
      description: video["video:description"],
      duration: video["video:duration"],
      viewCount: video["video:view_count"],
      videoUrl: video["video:content_loc"],
    });
  });

  let j = 0;

  for await (const chunk of response.body) {
    readableStream.push(textEncoder.decode(chunk));
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`Items processed: ${i} / ${page}`);
    j++;
  }
  isFetching = false;
}

async function fillStorage(storage, maxPages = 30, nextPage = 1) {
  let count = 0;
  await storage.beginTransaction();

  while (true) {
    try {
      console.log("Fetching page ", nextPage);

      await fetchSitemap(nextPage, async (item) => {
        count++;
        try {
          await storage.upsert(item);
        } catch (e) {
          console.error("Error inserting item", e);
        }
      });

      await storage.commitTransaction();
      await storage.beginTransaction();

      count = 0;
      nextPage++;

      if (nextPage > maxPages) {
        break;
      }
    } catch (e) {
      console.log("Indexing finished", e);
      console.log("Item", count);
      break;
    }
  }

  storage.commitTransaction();
  clearInterval(int);
}

async function getResultStreamUrls(result, fetchOptions = {}) {
  const detailPageUrl = result.detailPageUrl;
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
  let subtitles = [];

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
    const items = eval(sources);
    subtitles = items
      .filter((item) => item.kind === "captions")
      .map((item) => ({
        id: item.label,
        url: item.src,
        lang: item.srclang,
      }));
  } catch (error) {}

  return {
    detailPageUrl,
    video,
    subtitles,
  };
}

async function getSearchResults(title, fetchOptions = {}) {
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
    const sizeStr = linkEl
      .querySelector(".video__tag--size")
      .innerHTML.toUpperCase();

    return {
      title: linkEl.getAttribute("title"),
      detailPageUrl: `https://prehraj.to${linkEl.getAttribute("href")}`,
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

/** @typedef {import('../getTopItems.js').Resolver} Resolver */

/** @typedef {{userName: string, password: string}} Init */

/**
 * @param {Object?} Init
 * @returns Resolver
 */
function getResolver(initOptions) {
  let fetchOptions = {};
  let isIndexing = false;
  const storage = new Storage("./storage/.ulozto.sqlite");

  return {
    resolverName: "PrehrajTo",

    prepare: async () => {
      await storage.prepared;
      const lastReindexed = await storage.getMeta("lastReindexed");

      if (!isIndexing) {
        if (isOlder(1_000, lastReindexed)) {
          console.log("Reindexing site...");
          isIndexing = true;

          fillStorage(storage, 50).then(() => {
            storage.setMeta("lastReindexed", new Date().toISOString());
            storage.setMeta("lastUpdated", new Date().toISOString());
            isIndexing = false;
          });
        }
      }
    },

    init: async () => {
      await storage.prepared;

      if (initOptions) {
        const { userName, password } = initOptions;
        fetchOptions = await login(userName, password);
      } else {
        fetchOptions = loginAnonymous();
      }

      const lastReindexed = await storage.getMeta("lastReindexed");
      const lastUpdated = await storage.getMeta("lastUpdated");

      if (!isIndexing) {
        if (isOlder(86_400_000, lastReindexed)) {
          console.log("Reindexing site...");
          isIndexing = true;
          fillStorage(storage).then(() => {
            storage.setMeta("lastReindexed", new Date().toISOString());
            storage.setMeta("lastUpdated", new Date().toISOString());
            isIndexing = false;
          });
        } else if (isOlder(3_600_000, lastUpdated)) {
          isIndexing = true;
          console.log("Indexing new items...");
          fillStorage(storage, 1).then(() => {
            storage.setMeta("lastUpdated", new Date().toISOString());
            isIndexing = false;
          });
        }
      }
    },

    searchX: (title) => getSearchResults(title, fetchOptions),
    search: async (title) => {
      console.log(title);
      await storage.prepared;
      const rows = await storage.search(`"${title.replaceAll(" ", '"+"')}"`);
      console.log(rows);
      return rows.map((row) => ({
        title: row.title,
        detailPageUrl: row.url,
        duration: row.duration,
        format: row.video, // TODO
        size: undefined,
      }));
    },

    resolve: async (searchResult) => ({
      ...searchResult,
      ...(await getResultStreamUrls(searchResult, fetchOptions)),
    }),

    stats: async () => {
      const totalCount = await storage.count();
      return { totalCount };
    },
  };
}

module.exports = { getResolver };
