import { type Request, type Response } from "express";

import { type UserConfigData } from "../userConfig/userConfig.ts";
import { getActiveResolvers, getAllResolvers } from "../utils/resolvers.ts";

async function getMediaUrl(
  resolver: string,
  id: string,
  config: UserConfigData,
): Promise<string> {
  const allResolvers = getAllResolvers();
  const activeResolvers = await getActiveResolvers(allResolvers, config);
  const selectedResolver = activeResolvers.find(
    (r) => r.resolverName === resolver,
  );
  if (!selectedResolver) {
    throw new Error("No active resolver found");
  }
  const detail = await selectedResolver.resolve(id, config);
  return detail.video;
}

export default async function handler(req: Request, res: Response) {
  try {
    const url = new URL(req.protocol + "://" + req.hostname + req.url);
    const configJSON = url.searchParams.get("config");
    const config = configJSON ? JSON.parse(configJSON) : {};
    const parts = req.url.split("/");
    const resolverName = decodeURIComponent(parts[2]);
    const mediaId = decodeURIComponent(parts[3]);

    const mediaUrl = await getMediaUrl(resolverName, mediaId, config);

    res.writeHead(301, { Location: mediaUrl });
    res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end();
  }
}
