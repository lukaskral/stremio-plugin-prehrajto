import { type Request, type Response } from "express";
import { afterEach, describe, expect, test, vi } from "vitest";

import testHandler from "../../src/endpoints/test.ts";

const originalUsername = process.env.PREHRAJTO_DEBUG_USERNAME;
const originalPassword = process.env.PREHRAJTO_DEBUG_PASSWORD;

function setEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  setEnvironmentValue("PREHRAJTO_DEBUG_USERNAME", originalUsername);
  setEnvironmentValue("PREHRAJTO_DEBUG_PASSWORD", originalPassword);
});

function createResponse() {
  let body = "";
  let status: number | undefined;
  const response = {
    writeHead: vi.fn((nextStatus: number) => {
      status = nextStatus;
      return response;
    }),
    write: vi.fn((chunk: unknown) => {
      body += String(chunk);
      return true;
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk !== undefined) body += String(chunk);
      return response;
    }),
  } as unknown as Response;

  return {
    response,
    getBody: () => body,
    getStatus: () => status,
  };
}

describe("test endpoint credentials", () => {
  test.each([
    [undefined, undefined],
    ["debug@example.test", undefined],
    [undefined, "secret"],
  ])(
    "returns 503 for an incomplete credential pair",
    async (username, password) => {
      setEnvironmentValue("PREHRAJTO_DEBUG_USERNAME", username);
      setEnvironmentValue("PREHRAJTO_DEBUG_PASSWORD", password);
      const { response, getBody, getStatus } = createResponse();
      const request = {
        url: "/test/?q=movie",
        get protocol() {
          throw new Error("protocol must not be read without credentials");
        },
      } as unknown as Request;

      await testHandler(request, response);

      expect(getStatus()).toBe(503);
      expect(getBody()).toContain(
        "PREHRAJTO_DEBUG_USERNAME and PREHRAJTO_DEBUG_PASSWORD are required",
      );
    },
  );
});
