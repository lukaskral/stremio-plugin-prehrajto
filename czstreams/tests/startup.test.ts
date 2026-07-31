import { afterEach, describe, expect, test, vi } from "vitest";

import { runWithStartupHandling } from "../src/startup.ts";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe("runWithStartupHandling", () => {
  test("sets a nonzero exit code when startup fails", async () => {
    const error = new Error("listen failed");
    const logError = vi.fn();

    await runWithStartupHandling(
      async () => Promise.reject(error),
      logError,
    );

    expect(process.exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith("Failed to start server:", error);
  });

  test("leaves the exit code unchanged after successful startup", async () => {
    process.exitCode = undefined;

    await runWithStartupHandling(async () => undefined, vi.fn());

    expect(process.exitCode).toBeUndefined();
  });
});
