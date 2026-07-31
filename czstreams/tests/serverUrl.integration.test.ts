import {
  createServer,
  type OutgoingHttpHeaders,
  request as httpRequest,
  type RequestListener,
  type Server,
} from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import { getTopItems, type Resolver } from "../src/getTopItems.ts";
import { type Meta } from "../src/meta.ts";
import {
  createTrustProxy,
  installServerOriginContext,
} from "../src/serverOrigin.ts";
import { getServerUrl } from "../src/utils/getServerUrl.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startOriginServer(
  trustedProxies?: string,
  listener: RequestListener = (_request, response) => {
    response.end(getServerUrl());
  },
  logError: (message: string, error: unknown) => void = () => undefined,
): Promise<Server> {
  const server = createServer(listener);
  installServerOriginContext(
    server,
    createTrustProxy(trustedProxies),
    logError,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server;
}

function get(
  server: Server,
  headers: OutgoingHttpHeaders,
): Promise<{ body: string; status: number | undefined }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("request-scoped server URL", () => {
  test("returns the direct request origin", async () => {
    const server = await startOriginServer();

    await expect(
      get(server, { host: "homeassistant.local:52932" }),
    ).resolves.toEqual({
      body: "http://homeassistant.local:52932",
      status: 200,
    });
  });

  test("returns the public origin supplied by a trusted proxy", async () => {
    const server = await startOriginServer("loopback");

    await expect(
      get(server, {
        host: "czstreams:52932",
        "x-forwarded-host": "media.example.test",
        "x-forwarded-proto": "https",
      }),
    ).resolves.toEqual({
      body: "https://media.example.test",
      status: 200,
    });
  });

  test("rejects an invalid effective origin before invoking the listener", async () => {
    const server = await startOriginServer();

    await expect(get(server, { host: "user@example.test" })).resolves.toEqual({
      body: "Invalid request origin\r\n\r\n",
      status: 400,
    });
  });

  test("uses the public origin in a generated media callback URL", async () => {
    const meta = {
      names: { en: "Example Movie" },
      released: "2026",
      runtime: "90",
    } as unknown as Meta;
    const resolver: Resolver = {
      resolverName: "fake resolver",
      init: () => true,
      getConfigFields: () => [],
      validateConfig: async () => true,
      search: async () => [
        {
          resolverId: "item/123",
          title: "Example Movie 2026",
          detailPageUrl: "https://storage.example/item/123",
          duration: 5400,
          size: 3_000_000_000,
        },
      ],
      resolve: async () => ({ video: "https://storage.example/video" }),
    };
    const server = await startOriginServer(
      "loopback",
      (_request, response) => {
        void getTopItems(meta, [resolver], {}).then(
          ([item]) => response.end(item.video),
          (error: unknown) => {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : String(error));
          },
        );
      },
    );

    await expect(
      get(server, {
        host: "czstreams:52932",
        "x-forwarded-host": "media.example.test",
        "x-forwarded-proto": "https",
      }),
    ).resolves.toEqual({
      body: "https://media.example.test/media/fake%20resolver/item%2F123?config=%7B%7D",
      status: 200,
    });
  });
});
