export type OriginalMeta = {
  awards: string;
  cast: string[];
  country: string;
  description: string;
  director: string[];
  dvdRelease: string;
  genre: string[];
  imdbRating: string;
  imdb_id: string;
  moviedb_id: number;
  name: string;
  names: Record<string, string>;
  popularity: number;
  poster: string;
  released: string;
  runtime: string;
  trailers: Array<{
    source: string;
    type: string;
  }>;
  type: string;
  writer: string[];
  year: string;
  background: string;
  logo: string;
  episode?: {
    season: number;
    number: number;
  };
  popularities: {
    moviedb: number;
    stremio: number;
    trakt: number;
    stremio_lib: number;
  };
  slug: string;
  id: string;
  genres: string[];
  releaseInfo: string;
  trailerStreams: Array<{
    title: string;
    ytId: string;
  }>;
  links: Array<{
    name: string;
    category: string;
    url: string;
  }>;
  behaviorHints: Array<{
    defaultVideoId: string;
    hasScheduledVideos: boolean;
  }>;
  videos: Array<{
    season: number;
    number: number;
  }>;
};

export type Meta = OriginalMeta & {
  episode?: {
    season: number;
    number: number;
  };
  names: Record<string, string>;
};

export async function getMeta(
  type: "movie" | "series" | "channel" | "tv",
  id: string,
): Promise<Meta> {
  let canonicalId = id;
  let filter = null;

  if (type === "channel" || type === "tv") {
    return undefined;
  }

  if (type === "series") {
    const parts = id.split(":");
    canonicalId = parts[0];
    filter = {
      season: parseInt(parts[1]),
      number: parseInt(parts[2]),
    };
  }

  const response = await fetch(
    "https://v3-cinemeta.strem.io/meta/" + type + "/" + canonicalId + ".json",
  );
  const data: Meta = (
    (await response.json()) as {
      meta: OriginalMeta;
    }
  ).meta;

  if (filter) {
    data.episode = data.videos.find((video) =>
      Object.keys(filter).every(
        (key: keyof typeof filter) => filter[key] === video[key],
      ),
    );
  }

  return data;
}
