import { describe, expect, it } from "vitest";

import { getResolver } from "../../src/service/prehrajto.ts";
import { createPrehrajtoFixtureFetch } from "./fixtureFetch.ts";

const fixtureConfig = {
  prehrajtoUsername: "fixture-user@example.test",
  prehrajtoPassword: "fixture-password",
};

function expectControlPlaneCalls(
  calls: ReturnType<typeof createPrehrajtoFixtureFetch>["calls"],
  searchUrl: string,
  detailUrl: string,
) {
  expect(calls.map(({ url, method }) => [url, method])).toEqual([
    ["https://prehraj.to/", "GET"],
    ["https://prehraj.to/?frm=loginDialog-login-loginForm", "POST"],
    [searchUrl, "GET"],
    [detailUrl, "GET"],
  ]);
  expect(calls[1].body).toBeInstanceOf(FormData);
  expect(
    calls.some(({ url }) => url.startsWith("https://pf-storage")),
  ).toBe(false);
}

describe("PrehrajTo real-page fixtures", () => {
  it("parses a movie search result and var-sources detail page", async () => {
    const fixtureFetch = createPrehrajtoFixtureFetch();
    const resolver = getResolver(fixtureFetch.fetch);

    expect(await resolver.validateConfig(fixtureConfig)).toBe(true);
    const results = await resolver.search("harry potter", fixtureConfig);

    expect(results).toHaveLength(32);
    expect(results[0]).toMatchObject({
      resolverId:
        "/harry-potter-2-tajemna-komnata-cz-dabing-topkvalita/db75e654a52cf8d1",
      title: "Harry Potter  2 -  Tajemná komnata CZ Dabing TOPKVALITA",
      duration: 9656,
      format: "HD",
      size: 1.65 * 1073741824,
    });

    const details = await resolver.resolve(results[0].resolverId, fixtureConfig);

    expect(details).toEqual({
      video:
        "https://pf-storage4.premiumcdn.net/169834207/GjDSXMFgaiPRT8at2eSj9F58IWEtnkuBOhzxiWjCK5heXu3pSQPikWIW2uVbu9esjbCZ7CpBu3dUMZHVqiXWixbIXpUZpukPcEduZJUYet2msjQiK1ImV.mp4",
      subtitles: [],
    });
    expectControlPlaneCalls(
      fixtureFetch.calls,
      "https://prehraj.to/hledej/harry%20potter?vp-page=0",
      "https://prehraj.to/harry-potter-2-tajemna-komnata-cz-dabing-topkvalita/db75e654a52cf8d1",
    );

    await resolver.cleanup?.();
  });

  it("parses an episode search result and videojs fallback with captions", async () => {
    const fixtureFetch = createPrehrajtoFixtureFetch();
    const resolver = getResolver(fixtureFetch.fetch);

    expect(await resolver.validateConfig(fixtureConfig)).toBe(true);
    const results = await resolver.search("avatar titulky", fixtureConfig);

    expect(results).toHaveLength(32);
    expect(results[0]).toMatchObject({
      resolverId:
        "/avatar-legenda-o-aangovi-s01e07-cz-titulky-1080p-fullhd/65d760fdf1b83",
      title: "Avatar Legenda o Aangovi S01E07 CZ Titulky 1080p (FullHD)",
      duration: 2827,
      format: "HD",
      size: 2.25 * 1073741824,
    });

    const details = await resolver.resolve(results[0].resolverId, fixtureConfig);

    expect(details.video).toBe(
      "https://pf-storage4.premiumcdn.net/73809587/rZpHqPUPjSyaSLmtWBh6NUwqh0ZFbMFPefvzFoAuqETxJt3yhR4fvVtBjtV9H26sBdCvkuvMtqEfe1FDeH3mfgAtqzTzbFqVt4MCM2C9qTQxtrDIBEh6v.mp4",
    );
    expect(details.subtitles).toHaveLength(37);
    expect(details.subtitles?.[0]).toMatchObject({
      id: "CS - 4036422 - eng",
      lang: "cs",
      url: expect.stringContaining("https://pf-storage4.premiumcdn.net/"),
    });
    expectControlPlaneCalls(
      fixtureFetch.calls,
      "https://prehraj.to/hledej/avatar%20titulky?vp-page=0",
      "https://prehraj.to/avatar-legenda-o-aangovi-s01e07-cz-titulky-1080p-fullhd/65d760fdf1b83",
    );

    await resolver.cleanup?.();
  });
});
