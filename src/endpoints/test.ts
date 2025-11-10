import { type Request, type Response } from "express";

import { getResolver } from "../service/prehrajto.ts";

const NL = "\r\n\r\n";

export default async function test(req: Request, res: Response) {
  try {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    const url = new URL(req.protocol + "://" + req.hostname + req.url);
    const term = url.searchParams.get("q");
    const breakpoint = url.searchParams.get("breakpoint");

    const addonConfig = {
      prehrajtoUsername: "canifi7158@matmayer.com",
      prehrajtoPassword: "canifi7158",
    };
    const resolver = getResolver();
    const initialized = await resolver.init();
    const validated = await resolver.validateConfig(addonConfig);
    const debugInfo = resolver.debug();
    res.write(JSON.stringify({ initialized, validated, debugInfo }) + NL);

    if (breakpoint === "0") {
      res.end("Breakpoint 0");
      return;
    }

    const results = await resolver.search(
      term || "harry potter a kámen mudrců",
      addonConfig,
    );

    res.write("Results: " + results.length + NL);

    if (results.length === 0) {
      res.end("No results found");
      return;
    }

    res.write(
      `/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(results[0].resolverId)}` +
        NL,
    );

    if (breakpoint === "1") {
      res.end("Breakpoint 1");
      return;
    }

    const first = await resolver.resolve(results[0].resolverId, addonConfig);
    const videoUrl = first.video;

    res.write(JSON.stringify(results[0]) + NL);
    res.write("Video URL: " + videoUrl + NL);
    if (breakpoint === "2") {
      res.end("Breakpoint 2");
      return;
    }

    const response = await fetch(videoUrl, {
      headers: {
        Range: "bytes=0-1023",
      },
    });

    if (response.status >= 400) {
      res.write(JSON.stringify(response.headers) + NL);
      res.end("Response: " + response.status);
      return;
    }

    res.end("OK: " + response.status);
  } catch (e: any) {
    res.write(String(e) + NL);
    res.end("error");
  }
}
