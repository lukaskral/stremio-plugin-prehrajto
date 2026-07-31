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

  test("defines a zero-configuration CzStreams add-on", () => {
    const config = readYaml(resolve(addonRoot, "config.yaml"));

    expect(config).toMatchObject({
      name: "CzStreams",
      version: "0.1.11",
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
      schema: {},
    });
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
});
