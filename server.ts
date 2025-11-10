#!/usr/bin/env node

import { type Express, type Request, type Response } from "express";
import SDK from "stremio-addon-sdk";

import { addonInterface } from "./addon.ts";
import cleanupHandler from "./src/endpoints/cleanup.ts";
import mediaHandler from "./src/endpoints/getMediaUrl.ts";
import testHandler from "./src/endpoints/test.ts";

(
  SDK.serveHTTP(addonInterface, {
    port: process.env.PORT ? Number(process.env.PORT) : 52932,
  }) as any as Promise<{ server: Express; url: string }>
)
  .then(({ server }) => {
    // grab SDK's existing 'request' listeners
    const originalListeners = server.listeners("request").slice();

    // remove them and install a wrapper that handles custom routes first
    server.removeAllListeners("request");
    server.on("request", async (req: Request, res: Response) => {
      try {
        if (req.url && req.url.startsWith("/media/")) {
          mediaHandler(req, res);
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
        for (const l of originalListeners) {
          l.call(server, req, res);
        }
      } catch (e) {
        console.error(`Error on request ${req.url}`, e);
      }
    });
  })
  .catch((err: Error) => {
    console.error("Failed to start server:", err);
  });
