import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createGetMediaUrlHandler } from "../../src/endpoints/getMediaUrl.ts";
import type { Resolver } from "../../src/getTopItems.ts";

describe("/media", () => {
  it("uses proxy config for resolution but redirects to the unchanged direct media URL", async () => {
    const resolve = vi.fn(async () => ({
      video:
        "https://media.example.test/movie.mp4?token=unchanged&expires=never",
    }));
    const resolver: Resolver = {
      resolverName: "PrehrajTo",
      init: () => true,
      getConfigFields: () => [],
      validateConfig: async () => true,
      search: async () => [],
      resolve,
    };
    const handler = createGetMediaUrlHandler(() => [resolver]);
    const req = {
      protocol: "https",
      hostname: "addon.example.test",
      url:
        "/media/PrehrajTo/%2Fvideo%2F1?config=" +
        encodeURIComponent(
          JSON.stringify({
            proxyUrl: "https://proxy.example.test/proxy",
            proxyApiKey: "proxy-secret",
            prehrajtoUsername: "user",
            prehrajtoPassword: "password",
          }),
        ),
    } as Request;
    const writeHead = vi.fn();
    const end = vi.fn();
    const res = {
      writeHead,
      write: vi.fn(),
      end,
    } as unknown as Response;

    await handler(req, res);

    expect(resolve).toHaveBeenCalledWith("/video/1", {
      proxyUrl: "https://proxy.example.test/proxy",
      proxyApiKey: "proxy-secret",
      prehrajtoUsername: "user",
      prehrajtoPassword: "password",
    });
    expect(writeHead).toHaveBeenCalledWith(301, {
      Location:
        "https://media.example.test/movie.mp4?token=unchanged&expires=never",
    });
    expect(end).toHaveBeenCalledOnce();
  });
});
