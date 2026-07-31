import { parseHTML } from "linkedom";

import commonHeaders from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
};

export async function getImdbDetails(id: string, languageCode = "cs") {
  const imdbId = id.split(":").at(0);
  try {
    const pageResponse = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
      headers: {
        ...headers,
        "accept-language": `${languageCode};q=1.0, en;q=0.5`,
        "x-forwarded-for": "147.251.0.0", // todo find address range for given country
      },
      method: "GET",
    });
    const pageHtml = await pageResponse.text();
    const { document } = parseHTML(pageHtml);
    const scriptEls = document.querySelectorAll(
      "script[type='application/ld+json']",
    );
    const scriptEl = [...scriptEls].at(0);
    const data = JSON.parse(scriptEl.textContent);
    return data;
  } catch {
    return undefined;
  }
}
