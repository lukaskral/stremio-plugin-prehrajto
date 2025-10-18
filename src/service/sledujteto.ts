import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import { extractCookies, headerCookies } from "../utils/cookies.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  accept: "application/json",
  host: "www.sledujteto.cz",
  referer: "https://www.sledujteto.cz/",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

async function login(userName: string, password: string) {
  if (!userName) {
    return loginAnonymous();
  }

  const r1 = await fetch("https://www.sledujteto.cz/account/login/", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
    body: `email=${encodeURIComponent(userName)}&password=${encodeURIComponent(
      password,
    )}&remember=1&login=P%C5%99ihl%C3%A1sit&form_id=Form_Login&model_id=0`,
    method: "POST",
  });
  const cookies = extractCookies(r1);

  return {
    headers: headerCookies(cookies),
  };
}

async function loginAnonymous() {
  const result = await fetch("https://www.sledujteto.cz/", {
    headers,
    method: "GET",
  });

  const cookies = extractCookies(result);

  return {
    headers: headerCookies(cookies),
  };
}

const fetchOptionsCache = new Map();

async function getFetchOptions(userName: string, password: string) {
  const cacheKey = `${userName}:${password}`;
  const fetchOptions = fetchOptionsCache.get(cacheKey);
  if (fetchOptions) {
    return fetchOptions;
  }

  const newFetchOptions = await login(userName, password);
  fetchOptionsCache.set(cacheKey, newFetchOptions);
  return newFetchOptions;
}

async function getResultStreamUrls(
  result: SearchResult,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const pageResponse = await fetch(
    "https://www.sledujteto.cz/services/add-file-link",
    {
      headers: {
        ...headers,
        ...(fetchOptions.headers ?? {}),
        "content-type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({
        params: {
          id: result.resolverId,
        },
      }),
      method: "POST",
    },
  );
  const pageData = (await pageResponse.json()) as { hash: string };
  return {
    video: `https://www.sledujteto.cz/player/index/sledujteto/${pageData.hash}`,
    subtitles: [],
    behaviorHints: {
      notWebReady: true,
      proxyHeaders: {
        request: {
          ...headers,
          ...(fetchOptions.headers ?? {}),
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

async function getSearchResults(
  title: string,
  fetchOptions: FetchOptions = {},
): Promise<SearchResult[]> {
  const pageResponse = await fetch(
    `https://www.sledujteto.cz/services/get-files?query=${encodeURIComponent(title)}&limit=32&page=1&sort=relevance&collection=?vp-page=0`,
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

  const pageData = (await pageResponse.json()) as {
    error?: string;
    files: Array<{
      id: string;
      filename: string;
      full_url: string;
      movie_duration: string;
      movie_resolution: string;
      filesize: string;
    }>;
  };
  if (pageData.error) {
    return [];
  }

  const results = pageData.files.map((file) => {
    return {
      resolverId: file.id,
      title: file.filename,
      detailPageUrl: file.full_url,
      duration: timeToSeconds(file.movie_duration),
      format: file.movie_resolution,
      size: sizeToBytes(file.filesize),
    };
  });
  return results;
}

export function getResolver(): Resolver {
  return {
    resolverName: "SledujteTo",

    init: () => {
      /**
       * This resolver can't be easily fixed
       * It requires to call services/add-file-link endpoint every 30 seconds
       * with file id and current playback time
       */
      return false;
    },

    getConfigFields: () => [],

    validateConfig: async () => {
      /*
      if (!addonConfig.sledujtetoUsername || !addonConfig.sledujtetoPassword) {
        return false;
      }
      const fetchOptions = await getFetchOptions(
        addonConfig.sledujtetoUsername ?? "",
        addonConfig.sledujtetoPassword,
      );
      */
      return false; //"headers" in fetchOptions;
    },

    search: async (title, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.sledujtetoUsername ?? "",
        addonConfig.sledujtetoPassword,
      );
      return getSearchResults(title, fetchOptions);
    },

    resolve: async (searchResult, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.sledujtetoUsername ?? "",
        addonConfig.sledujtetoPassword,
      );
      return {
        ...searchResult,
        ...(await getResultStreamUrls(searchResult, fetchOptions)),
      };
    },
  };
}
