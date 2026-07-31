import { readFile } from "node:fs/promises";

const fixtureDirectory = new URL(
  "../fixtures/prehrajto/",
  import.meta.url,
);

const fixturePaths = {
  movieSearch: new URL("search-movie.html", fixtureDirectory),
  movieDetail: new URL("detail-movie.html", fixtureDirectory),
  seriesSearch: new URL("search-series.html", fixtureDirectory),
  seriesDetail: new URL("detail-series.html", fixtureDirectory),
};

export type FixtureCall = {
  url: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
};

export function createPrehrajtoFixtureFetch() {
  const calls: FixtureCall[] = [];

  const fixtureFetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ url, method, headers, body: init?.body });

    if (url === "https://prehraj.to/" && method === "GET") {
      return new Response("fixture home", {
        headers: { "set-cookie": "anonymous=fixture; Path=/" },
      });
    }

    if (
      url === "https://prehraj.to/?frm=loginDialog-login-loginForm" &&
      method === "POST"
    ) {
      if (!(init?.body instanceof FormData)) {
        throw new Error("Expected the login request body to be FormData");
      }
      if (
        init.body.get("email") !== "fixture-user@example.test" ||
        init.body.get("password") !== "fixture-password"
      ) {
        throw new Error("Unexpected fixture login credentials");
      }

      return new Response("fixture login", {
        headers: { "set-cookie": "access_token=fixture; Path=/" },
      });
    }

    const fixture =
      url === "https://prehraj.to/hledej/harry%20potter?vp-page=0"
        ? fixturePaths.movieSearch
        : url === "https://prehraj.to/hledej/avatar%20titulky?vp-page=0"
          ? fixturePaths.seriesSearch
          : url ===
              "https://prehraj.to/harry-potter-2-tajemna-komnata-cz-dabing-topkvalita/db75e654a52cf8d1"
            ? fixturePaths.movieDetail
            : url ===
                "https://prehraj.to/avatar-legenda-o-aangovi-s01e07-cz-titulky-1080p-fullhd/65d760fdf1b83"
              ? fixturePaths.seriesDetail
              : null;

    if (fixture && method === "GET") {
      return new Response(await readFile(fixture, "utf8"), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    throw new Error(`Unexpected fixture fetch: ${method} ${url}`);
  }) satisfies typeof globalThis.fetch;

  return { fetch: fixtureFetch, calls };
}
