import { expect, it } from "vitest";

import { getResolver } from "../../src/service/prehrajto.ts";

it("PrehrajTo uses the injected transport only for control-plane requests", async () => {
  const calls: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: RequestInit["body"];
  }> = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    if (url === "https://prehraj.to/") {
      return new Response("home", {
        headers: { "set-cookie": "anonymous=one; Path=/" },
      });
    }
    if (url.includes("frm=loginDialog")) {
      return new Response("logged-in", {
        headers: { "set-cookie": "access_token=two; Path=/" },
      });
    }
    if (url.includes("/hledej/")) {
      return new Response(`
        <a class="video--link" href="/video/1" title="Movie 2026">
          <span class="video__tag--size">1 GB</span>
          <span class="video__tag--time">01:30:00</span>
        </a>
      `);
    }
    if (url === "https://prehraj.to/video/1") {
      return new Response(`
        <script>
          var sources = [{file: "https://media.example.test/movie.mp4"}];
          var tracks = [];
        </script>
      `);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) satisfies typeof fetch;

  const resolver = getResolver(fetchImpl);
  const config = {
    prehrajtoUsername: "debug@example.test",
    prehrajtoPassword: "not-a-real-secret",
  };

  expect(await resolver.validateConfig(config)).toBe(true);
  const results = await resolver.search("Movie 2026", config);
  expect(results).toHaveLength(1);
  const details = await resolver.resolve(results[0].resolverId, config);
  expect(details.video).toBe("https://media.example.test/movie.mp4");

  expect(
    calls.map(({ url, method }) => [url, method]),
  ).toEqual([
      ["https://prehraj.to/", "GET"],
      ["https://prehraj.to/?frm=loginDialog-login-loginForm", "POST"],
      ["https://prehraj.to/hledej/Movie%202026?vp-page=0", "GET"],
      ["https://prehraj.to/video/1", "GET"],
    ]);
  expect(calls[1].body).toBeInstanceOf(FormData);
  expect(calls[2].headers.get("cookie")).toBe("access_token=two");
  expect(
    calls.some(({ url }) => url.startsWith("https://media.example.test/")),
  ).toBe(false);

  await resolver.cleanup?.();
});
