import { beforeEach, expect, it, vi } from "vitest";

const routingMocks = vi.hoisted(() => ({
  getMeta: vi.fn(),
  getTmdbDetails: vi.fn(),
  getTopItems: vi.fn(),
  getAllResolvers: vi.fn(),
}));

vi.mock("../src/meta.ts", () => ({
  getMeta: routingMocks.getMeta,
}));

vi.mock("../src/service/tmdb.ts", () => ({
  getTmdbDetails: routingMocks.getTmdbDetails,
}));

vi.mock("../src/getTopItems.ts", () => ({
  getTopItems: routingMocks.getTopItems,
}));

vi.mock("../src/utils/resolvers.ts", () => ({
  getAllResolvers: routingMocks.getAllResolvers,
}));

beforeEach(() => {
  vi.clearAllMocks();
  routingMocks.getAllResolvers.mockReturnValue([
    {
      resolverName: "PrehrajTo",
      getConfigFields: () => [
        {
          key: "prehrajtoUsername",
          type: "text",
          title: "PrehrajTo username",
        },
        {
          key: "prehrajtoPassword",
          type: "password",
          title: "PrehrajTo password",
        },
      ],
    },
  ]);
});

it("keeps Cinemeta and TMDB direct while passing proxy config only to the resolver flow", async () => {
  const proxyConfig = {
    proxyUrl: "https://proxy.example.test/proxy",
    proxyApiKey: "proxy-secret",
    prehrajtoUsername: "user@example.test",
    prehrajtoPassword: "password",
  };
  const lazyMediaUrl =
    "https://addon.example.test/media/PrehrajTo/%2Fvideo%2F1?config=encoded";
  const baseMeta = {
    id: "tt1234567",
    name: "Original title",
    names: { en: "Original title" },
    released: "2024-01-01T00:00:00.000Z",
  };
  routingMocks.getMeta.mockResolvedValue(baseMeta);
  routingMocks.getTmdbDetails.mockResolvedValue({
    names: { cs: "Český název" },
  });
  routingMocks.getTopItems.mockResolvedValue([
    {
      resolverId: "/video/1",
      resolverName: "PrehrajTo",
      title: "Original title 2024",
      detailPageUrl: "https://prehraj.to/video/1",
      duration: 7_200,
      size: 1_024,
      score: 100,
      video: lazyMediaUrl,
    },
  ]);

  const { addonInterface } = await import("../addon.ts");
  const response = await (
    addonInterface.get as unknown as (
      resource: string,
      type: string,
      id: string,
      extra: object,
      config: typeof proxyConfig,
    ) => Promise<{ streams: Array<{ url: string }> }>
  )("stream", "movie", "tt1234567", {}, proxyConfig);

  expect(routingMocks.getMeta).toHaveBeenCalledOnce();
  expect(routingMocks.getMeta).toHaveBeenCalledWith("movie", "tt1234567");
  expect(routingMocks.getTmdbDetails).toHaveBeenCalledOnce();
  expect(routingMocks.getTmdbDetails).toHaveBeenCalledWith("tt1234567", "cs");
  expect(routingMocks.getTopItems).toHaveBeenCalledWith(
    {
      ...baseMeta,
      names: {
        en: "Original title",
        cs: "Český název",
      },
    },
    routingMocks.getAllResolvers.mock.results.at(-1)?.value,
    proxyConfig,
  );
  expect(response.streams).toHaveLength(1);
  expect(response.streams[0].url).toBe(lazyMediaUrl);
});
