import { describe, expect, it, vi } from "vitest";

import { logRequestHandlerFailure } from "../../src/utils/safeLogging.ts";

describe("safe request logging", () => {
  it("does not log the request URL or escaped error details", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    logRequestHandlerFailure(
      "/test/?proxyApiKey=proxy-key-sentinel&q=target-query-sentinel",
      new Error("debug-password-sentinel media-query-sentinel"),
    );

    expect(consoleError).toHaveBeenCalledWith("Request handler failed");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(
      /proxy-key-sentinel|target-query-sentinel|debug-password-sentinel|media-query-sentinel/,
    );
  });
});
