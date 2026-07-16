import assert from "node:assert/strict";
import test from "node:test";

import { getResolver } from "../../src/service/prehrajto.ts";

test("PrehrajTo uses the injected transport only for control-plane requests", async () => {
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

  assert.equal(await resolver.validateConfig(config), true);
  const results = await resolver.search("Movie 2026", config);
  assert.equal(results.length, 1);
  const details = await resolver.resolve(results[0].resolverId, config);
  assert.equal(details.video, "https://media.example.test/movie.mp4");

  assert.deepEqual(
    calls.map(({ url, method }) => [url, method]),
    [
      ["https://prehraj.to/", "GET"],
      ["https://prehraj.to/?frm=loginDialog-login-loginForm", "POST"],
      ["https://prehraj.to/hledej/Movie%202026?vp-page=0", "GET"],
      ["https://prehraj.to/video/1", "GET"],
    ],
  );
  assert.ok(calls[1].body instanceof FormData);
  assert.equal(calls[2].headers.get("cookie"), "access_token=two");
  assert.equal(
    calls.some(({ url }) => url.startsWith("https://media.example.test/")),
    false,
  );

  await resolver.cleanup?.();
});
