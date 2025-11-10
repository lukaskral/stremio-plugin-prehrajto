import { type Request, type Response } from "express";

import { initResolvers } from "../initResolvers.ts";

const NL = "\r\n\r\n";

export default async function cleanup(req: Request, res: Response) {
  try {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    const resolvers = await initResolvers();
    resolvers.map((r) => r.cleanup());
    res.end("OK");
  } catch (e: any) {
    res.write(String(e) + NL);
    res.end("error");
  }
}
