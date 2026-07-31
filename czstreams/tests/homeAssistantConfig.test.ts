import { describe, expect, test, vi } from "vitest";

import {
  getHomeAssistantEnvironment,
  loadHomeAssistantOptions,
  parseHomeAssistantOptions,
} from "../src/homeAssistantConfig.ts";

describe("Home Assistant configuration", () => {
  test("maps configured debug credentials without changing their values", () => {
    expect(
      getHomeAssistantEnvironment({
        prehrajto_debug_username: "debug@example.test",
        prehrajto_debug_password: "  exact password  ",
      }),
    ).toEqual({
      PREHRAJTO_DEBUG_USERNAME: "debug@example.test",
      PREHRAJTO_DEBUG_PASSWORD: "  exact password  ",
    });
  });

  test("maps trusted proxy ranges without changing their value", () => {
    expect(
      getHomeAssistantEnvironment({
        trusted_proxies: "172.30.32.0/23, 192.168.1.10",
      }),
    ).toEqual({
      TRUST_PROXY: "172.30.32.0/23, 192.168.1.10",
    });
  });

  test.each([
    [{}, {}],
    [{ prehrajto_debug_username: "" }, {}],
    [{ prehrajto_debug_password: "" }, {}],
    [{ trusted_proxies: "" }, {}],
    [{ trusted_proxies: 42 }, {}],
    [
      { prehrajto_debug_username: "debug@example.test" },
      { PREHRAJTO_DEBUG_USERNAME: "debug@example.test" },
    ],
    [
      { prehrajto_debug_password: "secret" },
      { PREHRAJTO_DEBUG_PASSWORD: "secret" },
    ],
  ])("maps optional values from %j", (options, expected) => {
    expect(getHomeAssistantEnvironment(options)).toEqual(expected);
  });

  test("parses an options object", () => {
    expect(parseHomeAssistantOptions('{"prehrajto_debug_username":"u"}'))
      .toEqual({ prehrajto_debug_username: "u" });
  });

  test.each(["null", "[]", '"value"'])(
    "rejects non-object JSON %s",
    (json) => {
      expect(() => parseHomeAssistantOptions(json)).toThrow(
        "Home Assistant options must be a JSON object",
      );
    },
  );

  test("rejects malformed JSON", () => {
    expect(() => parseHomeAssistantOptions("{")).toThrow(SyntaxError);
  });

  test("loads the Supervisor options file", async () => {
    const readOptionsFile = vi.fn(async () =>
      '{"prehrajto_debug_password":"p"}'
    );

    await expect(loadHomeAssistantOptions("/data/options.json", readOptionsFile))
      .resolves.toEqual({ prehrajto_debug_password: "p" });
    expect(readOptionsFile).toHaveBeenCalledWith("/data/options.json", "utf8");
  });

  test("treats a missing options file as empty configuration", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const readOptionsFile = vi.fn(async () => Promise.reject(missing));

    await expect(loadHomeAssistantOptions("/data/options.json", readOptionsFile))
      .resolves.toEqual({});
  });

  test("does not hide other file read failures", async () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const readOptionsFile = vi.fn(async () => Promise.reject(denied));

    await expect(loadHomeAssistantOptions("/data/options.json", readOptionsFile))
      .rejects.toBe(denied);
  });
});
