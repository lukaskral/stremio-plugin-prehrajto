import { describe, expect, it } from "vitest";

import { cartesian } from "../src/utils/cartesian.ts";
import {
  bytesToSize,
  sizeToBytes,
  timeToSeconds,
} from "../src/utils/convert.ts";
import { normalizeString } from "../src/utils/normalizeString.ts";

describe("cartesian", () => {
  it("returns every combination of the provided arrays", () => {
    expect(cartesian([1, 2], ["a", "b"])).toEqual([
      [1, "a"],
      [1, "b"],
      [2, "a"],
      [2, "b"],
    ]);
  });
});

describe("convert", () => {
  it("converts colon-separated durations to seconds", () => {
    expect(timeToSeconds("1:02:03")).toBe(3723);
    expect(timeToSeconds("12:34")).toBe(754);
  });

  it("converts sizes in decimal units used by service results", () => {
    expect(sizeToBytes("1.5GB")).toBe(1.5 * 1073741824);
    expect(sizeToBytes("512KB")).toBe(512 * 1024);
  });

  it("formats bytes with a readable unit", () => {
    expect(bytesToSize(1024)).toBe("1kB");
    expect(bytesToSize(1048576)).toBe("1MB");
  });
});

describe("normalizeString", () => {
  it("removes accents, lowercases text, and normalizes separators", () => {
    expect(normalizeString("Harry Potter: A kámen-mudrců!")).toBe(
      "harry potter a kamen mudrcu ",
    );
  });
});
