import { type Request, type Response } from "express";

import { getResolver } from "../service/prehrajto.ts";

export default async function test(req: Request, res: Response) {
  const addonConfig = {
    prehrajtoUsername: "canifi7158@matmayer.com",
    prehrajtoPassword: "canifi7158",
  };
  const resolver = getResolver();
  await resolver.init();
  res.writeHead(200);

  const results = await resolver.search(
    "harry potter a kámen mudrců",
    addonConfig,
  );
  res.write(
    `/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(results[0].resolverId)}`,
  );

  res.write("Results: " + results.length);

  if (results.length === 0) {
    res.end("No results found");
    return;
  }

  const first = await resolver.resolve(results[0].resolverId, addonConfig);
  const videoUrl = first.video;

  res.write(JSON.stringify(results[0]));
  res.write("Video URL: " + videoUrl);

  const response = await fetch(videoUrl, {
    headers: {
      Range: "bytes=0-1023",
    },
  });

  if (response.status >= 400) {
    res.write(JSON.stringify(response.headers));
    res.end("Response: " + response.status);
    return;
  }

  res.end("OK: " + response.status);
}
