#!/usr/bin/env node

import { type Server } from "node:http";

import { type Request, type Response } from "express";
import SDK from "stremio-addon-sdk";

import { addonInterface } from "./addon.ts";
import cleanupHandler from "./src/endpoints/cleanup.ts";
import mediaHandler from "./src/endpoints/getMediaUrl.ts";
import serviceProxyHandler from "./src/endpoints/serviceProxy.ts";
import testHandler from "./src/endpoints/test.ts";
import { runWithStartupHandling } from "./src/startup.ts";

const serveHTTP = SDK.serveHTTP as unknown as (
  addon: typeof addonInterface,
  options: { port: number },
) => Promise<{ server: Server; url: string }>;

void runWithStartupHandling(async () => {
  const { server } = await serveHTTP(addonInterface, {
    port: process.env.PORT ? Number(process.env.PORT) : 52932,
  });

  // grab SDK's existing 'request' listeners
  const originalListeners = server.listeners("request").slice();

  // remove them and install a wrapper that handles custom routes first
  server.removeAllListeners("request");
  server.on("request", async (req: Request, res: Response) => {
    try {
      if (req.url && req.url.split("?", 1)[0] === "/internal/service-proxy") {
        await serviceProxyHandler(req, res);
        return;
      }

      if (req.url && req.url.startsWith("/media/")) {
        await mediaHandler(req, res);
        return;
      }

      if (req.url && req.url.startsWith("/test/")) {
        await testHandler(req, res);
        return;
      }

      if (req.url && req.url.startsWith("/clean/")) {
        await cleanupHandler(req, res);
        return;
      }

      // fallback to the original SDK listeners
      for (const listener of originalListeners) {
        listener.call(server, req, res);
      }
    } catch (error) {
      console.error(`Error on request ${req.url}`, error);
    }
  });
});
