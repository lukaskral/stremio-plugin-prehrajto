import type { Resolver, StreamDetails } from "../getTopItems.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  accept: "application/json",
  host: "www.hellspy.to",
  referer: "https://www.hellspy.to/",
};

async function getFetchOptions() {
  return {};
}

async function getResultStreamUrls(
  resolverId: string,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const linksRegexp = /\\"links\\":(\{.*?\})/gi;
  const detailPageUrl = `https://www.hellspy.to/video/${resolverId}`;
  const pageResponse = await fetch(detailPageUrl, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
  });
  const pageHtml = await pageResponse.text();
  const videoSourcesJson = linksRegexp
    .exec(pageHtml)[1]
    .replaceAll("\\\u0026", "&")
    .replaceAll('\\"', '"');
  const videoSources = Object.entries(JSON.parse(videoSourcesJson))
    .map(([resolution, link]: [string, string]) => ({
      link,
      resolution: parseInt(resolution),
    }))
    .filter((o) => o.link)
    .sort((a, b) => b.resolution - a.resolution);

  return {
    video: videoSources[0].link,
    subtitles: [],
    behaviorHints: {},
  };
}

async function getSearchResults(
  title: string,
  fetchOptions: FetchOptions = {},
) {
  const pageResponse = await fetch(
    `https://www.hellspy.to/api/search?query=${encodeURIComponent(title)}&offset=0`,
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
    status: string;
    payload: {
      data: Array<{
        id: string;
        name: string;
        slug: string;
        length: number;
        movie_resolution: string;
        size: string;
      }>;
    };
  };
  if (pageData.status !== "ok") {
    return [];
  }

  const results = pageData.payload.data.map((file) => {
    return {
      resolverId: `${file.slug}/${file.id}`,
      title: file.name,
      detailPageUrl: `https://www.hellspy.to/video/${file.slug}/${file.id}`,
      duration: file.length,
      format: file.movie_resolution,
      size: parseInt(file.size),
    };
  });

  return results;
}

export function getResolver(): Resolver {
  return {
    resolverName: "HellspyTo",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title) => {
      const fetchOptions = await getFetchOptions();
      return getSearchResults(title, fetchOptions);
    },

    resolve: async (resolverId) => {
      const fetchOptions = await getFetchOptions();
      return getResultStreamUrls(resolverId, fetchOptions);
    },
  };
}
