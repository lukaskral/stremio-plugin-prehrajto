import { ExternalId, MovieDb } from "moviedb-promise";

export async function getTmdbDetails<L extends string>(
  id: string,
  languageCode: L,
) {
  try {
    const tmdb = new MovieDb("701719e8e565886203b9a0abbf01a11c");

    const data = await tmdb.find({
      external_source: ExternalId.ImdbId,
      id,
      language: languageCode,
    });

    const result = data.movie_results.at(0);
    const title = result.title;
    const origTitle = result.original_title;
    const origLng = result.original_language;
    const hasOriginalTitle = Boolean(origTitle && origLng);

    return {
      ...result,
      names: {
        [languageCode]: title,
        ...(hasOriginalTitle
          ? {
              [origLng]: origTitle,
            }
          : {}),
      } as Record<L, string> & Record<string, string>,
    };
  } catch {
    return undefined;
  }
}
