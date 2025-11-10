import type { Meta } from "./meta.ts";
import { computeScore } from "./score.ts";
import type { ConfigField, UserConfigData } from "./userConfig/userConfig.ts";
import { cartesian } from "./utils/cartesian.ts";
import { deduplicateByProp } from "./utils/deduplicateByProp.ts";
import { getServerUrl } from "./utils/getServerUrl.ts";
import { getActiveResolvers } from "./utils/resolvers.ts";

export type SearchResult = {
  resolverId: string;
  title: string;
  detailPageUrl: string;
  duration: number;
  format?: string;
  size: number;
};

export type ScoredSearchResult = SearchResult & {
  resolverName: string;
  score: number;
};

export type StreamDetails = Partial<SearchResult> & {
  video: string;
  subtitles?: { id: string; url: string; lang: string }[];
  behaviorHints?: {
    countryWhitelist?: string[] | undefined;
    notWebReady?: boolean | undefined;
    group?: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headers?: any;
  };
};

export type StreamResult = ScoredSearchResult & StreamDetails;

export type Resolver = {
  resolverName: string;
  init: () => boolean;
  getConfigFields: () => ConfigField[];
  validateConfig: (config: UserConfigData) => Promise<boolean>;
  search: (title: string, config: UserConfigData) => Promise<SearchResult[]>;
  resolve: (
    resolverId: string,
    config: UserConfigData,
  ) => Promise<StreamDetails>;
  cleanup?: () => Promise<void>;
  debug?: () => unknown;
};

export async function getTopItems(
  meta: Meta,
  allResolvers: Resolver[],
  config: UserConfigData,
): Promise<StreamResult[]> {
  const resolvers = await getActiveResolvers(allResolvers, config);
  const searchTerms = getSearchTerms(meta);

  const scoredSearchResultPromises = cartesian(resolvers, searchTerms).map(
    async ([resolver, searchTerm]) => {
      const searchResults = await resolver.search(searchTerm, config);
      const scoredSearchResults = searchResults
        .map((r) => ({
          resolverName: resolver.resolverName,
          score: computeScore(meta, r),
          ...r,
        }))
        .filter((r) => r.score > 0);

      scoredSearchResults.sort(compareScores);
      const topItems: ScoredSearchResult[] =
        scoredSearchResults.length > 30
          ? scoredSearchResults.slice(0, 30)
          : scoredSearchResults;
      return topItems;
    },
  );

  const searchResults = deduplicateByProp(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await Promise.allSettled(scoredSearchResultPromises as Promise<any>[]))
      .map((r) => (r.status === "fulfilled" && r.value ? r.value : null))
      .filter((r) => Array.isArray(r))
      .flat(),
    "resolverId",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any as ScoredSearchResult[];

  const results = searchResults.map(
    (searchResult: StreamResult): StreamResult => {
      const resolver = resolvers.find(
        (r) => searchResult.resolverName === r.resolverName,
      );
      if (!resolver) {
        return null;
      }
      const data = {
        video: `${getServerUrl()}/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(searchResult.resolverId)}?config=${encodeURIComponent(JSON.stringify(config))}`,
        // ...(await resolver.resolve(searchResult.resolverId, config)),
      };
      return {
        ...searchResult,
        ...data,
      };
    },
  );
  results.sort(compareScores);

  return results;
}

/**
 * @param {Meta} meta
 * @returns {string[]}
 */
function getSearchTerms(meta: Meta): string[] {
  /** @type {string[]} */
  const searches: string[] = [];

  if (meta.episode) {
    const eps = String(meta.episode.season).padStart(2, "0");
    const epn = String(meta.episode.number).padStart(2, "0");

    if (meta.names.en) {
      searches.push(`${meta.names.en} S${eps}E${epn}`);
      searches.push(`${meta.names.en} ${eps}x${epn}`);
    }
    if (meta.names.cs) {
      searches.push(`${meta.names.cs} S${eps}E${epn}`);
      searches.push(`${meta.names.cs} ${eps}x${epn}`);
    }
  } else {
    const releaseYear = new Date(meta.released).getFullYear();
    if (meta.names.en) {
      searches.push(`${meta.names.en} ${releaseYear}`);
    }
    if (meta.names.cs) {
      searches.push(`${meta.names.cs} ${releaseYear}`);
    }
  }
  return searches;
}

function compareScores(a: StreamResult, b: StreamResult) {
  return b.score - a.score;
}
