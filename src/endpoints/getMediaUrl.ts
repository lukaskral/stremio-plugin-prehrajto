import { type Request, type Response } from "express";

import { type UserConfigData } from "../userConfig/userConfig.ts";
import { getActiveResolvers, getAllResolvers } from "../utils/resolvers.ts";

const NL = "\r\n\r\n";

type GetResolvers = typeof getAllResolvers;

async function getMediaUrl(
  resolver: string,
  id: string,
  config: UserConfigData,
  getResolvers: GetResolvers,
): Promise<string> {
  const allResolvers = getResolvers();
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

export function createGetMediaUrlHandler(
  getResolvers: GetResolvers = getAllResolvers,
) {
  return async function handler(req: Request, res: Response) {
    try {
      const url = new URL(req.protocol + "://" + req.hostname + req.url);
      const configJSON = url.searchParams.get("config");
      const config = configJSON ? JSON.parse(configJSON) : {};
      const parts = url.pathname.split("/");
      const resolverName = decodeURIComponent(parts[2]);
      const mediaId = decodeURIComponent(parts[3]);

      const mediaUrl = await getMediaUrl(
        resolverName,
        mediaId,
        config,
        getResolvers,
      );

      res.writeHead(301, { Location: mediaUrl });
      res.end();
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.write((e instanceof Error ? e.message : String(e)) + NL);
      res.end();
    }
  };
}

export default createGetMediaUrlHandler();
