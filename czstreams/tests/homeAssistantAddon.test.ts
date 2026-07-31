import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const addonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(addonRoot, "..");

function readYaml(path: string): Record<string, unknown> {
  return parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("Home Assistant add-on metadata", () => {
  test("defines this GitHub repository", () => {
    expect(readYaml(resolve(repositoryRoot, "repository.yaml"))).toEqual({
      name: "CzStreams Home Assistant Add-on",
      url: "https://github.com/lukaskral/stremio-plugin-prehrajto",
      maintainer: "Lukas Kral",
    });
  });

  test("defines optional debug credentials for CzStreams", () => {
    const config = readYaml(resolve(addonRoot, "config.yaml"));
    const packageJson = JSON.parse(
      readFileSync(resolve(addonRoot, "package.json"), "utf8"),
    ) as { version: string };

    expect(config).toMatchObject({
      name: "CzStreams",
      version: "0.1.12",
      slug: "czstreams",
      startup: "application",
      boot: "auto",
      init: false,
      arch: ["amd64", "aarch64"],
      ports: { "52932/tcp": 52932 },
      ports_description: {
        "52932/tcp": "CzStreams Stremio add-on",
      },
      webui: "http://[HOST]:[PORT:52932]/",
      options: {},
      schema: {
        prehrajto_debug_username: "str?",
        prehrajto_debug_password: "password?",
      },
    });
    expect(packageJson.version).toBe(config.version);
    expect(config).not.toHaveProperty("ingress");
  });

  test("keeps every application build input in the add-on directory", () => {
    for (const path of [
      "Dockerfile",
      "run.sh",
      "package.json",
      "package-lock.json",
      "server.ts",
      "addon.ts",
      "src",
    ]) {
      expect(existsSync(resolve(addonRoot, path)), path).toBe(true);
    }
  });

  test("runs TypeScript directly on Node 24 with Home Assistant labels", () => {
    const dockerfile = readFileSync(resolve(addonRoot, "Dockerfile"), "utf8");
    const runScript = readFileSync(resolve(addonRoot, "run.sh"), "utf8");
    const tsconfig = readFileSync(resolve(addonRoot, "tsconfig.json"), "utf8");

    expect(dockerfile).toMatch(/^FROM node:24-alpine$/m);
    expect(dockerfile).toContain("ARG BUILD_VERSION");
    expect(dockerfile).toContain("ARG BUILD_ARCH");
    expect(dockerfile).toContain('io.hass.version="${BUILD_VERSION}"');
    expect(dockerfile).toContain('io.hass.type="app"');
    expect(dockerfile).toContain('io.hass.arch="${BUILD_ARCH}"');
    expect(dockerfile).toContain("RUN npm ci --omit=dev");
    expect(dockerfile).toContain("COPY server.ts addon.ts ./");
    expect(dockerfile).toContain("COPY src ./src");
    expect(dockerfile).not.toContain("npm run build");
    expect(runScript).toContain("exec npm run start");
    expect(tsconfig).toContain('"addon.ts"');
    expect(tsconfig).toContain('"server.ts"');
  });
});
