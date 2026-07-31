# Home Assistant Debug Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose optional PrehrajTo debug credentials in Home Assistant and load them into the existing `/test` endpoint environment variables without changing behavior when they are absent.

**Architecture:** Add optional masked Home Assistant schema fields, then load `/data/options.json` through a small tested configuration boundary before importing the existing server. Keep local startup unchanged, make the test endpoint independent of Express-only request properties, and increment the add-on and package versions together.

**Tech Stack:** Home Assistant add-on YAML, Node.js 24 native TypeScript, npm, Vitest, Docker

---

## File structure

- `czstreams/config.yaml`: declares the two optional Home Assistant fields and add-on version.
- `czstreams/src/homeAssistantConfig.ts`: parses Supervisor options and converts them to environment updates.
- `czstreams/homeAssistant.ts`: applies Supervisor options before loading the server.
- `czstreams/run.sh`: starts the Home Assistant-specific entry point.
- `czstreams/package.json` and `czstreams/package-lock.json`: define the new startup command and version.
- `czstreams/Dockerfile`: includes the Home Assistant launcher in the runtime image.
- `czstreams/src/endpoints/test.ts`: preserves the missing-credential response and parses raw Node request URLs safely.
- `czstreams/tests/homeAssistantConfig.test.ts`: verifies parsing, missing-file handling, and secret mapping.
- `czstreams/tests/endpoints/testEndpoint.test.ts`: verifies missing and partial credentials return the existing `503` response.
- `czstreams/tests/homeAssistantAddon.test.ts`: verifies metadata, version alignment, and launcher packaging.
- `czstreams/DOCS.md` and `czstreams/CHANGELOG.md`: document the optional settings and release.

### Task 1: Define optional credential metadata and release version

**Files:**
- Modify: `czstreams/tests/homeAssistantAddon.test.ts`
- Modify: `czstreams/config.yaml`
- Modify: `czstreams/package.json`
- Modify: `czstreams/package-lock.json`
- Modify: `czstreams/CHANGELOG.md`

- [x] **Step 1: Write the failing metadata assertions**

In `czstreams/tests/homeAssistantAddon.test.ts`, load `package.json` in the
zero-configuration test and replace the existing version/options/schema
assertions with:

```ts
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
```

Rename the test to `defines optional debug credentials for CzStreams`.

- [x] **Step 2: Run the metadata test and verify it fails**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: FAIL because the current version is `0.1.11` and `schema` is empty.

- [x] **Step 3: Increment the package version without creating a Git tag**

Run: `npm version 0.1.12 --no-git-tag-version`

Working directory: `czstreams/`

Expected: both package files contain version `0.1.12`.

- [x] **Step 4: Add the optional Home Assistant schema**

Change the version and schema in `czstreams/config.yaml` to:

```yaml
version: "0.1.12"
```

```yaml
options: {}
schema:
  prehrajto_debug_username: str?
  prehrajto_debug_password: password?
```

- [x] **Step 5: Add the release entry**

Insert this section above `0.1.11` in `czstreams/CHANGELOG.md`:

```markdown
## 0.1.12

- Add optional Home Assistant configuration for the PrehrajTo debug username
  and password used by the `/test` endpoint.
```

- [x] **Step 6: Run the metadata test and verify it passes**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: all metadata tests pass.

- [x] **Step 7: Commit metadata and versioning**

```bash
git add czstreams/config.yaml czstreams/package.json czstreams/package-lock.json \
  czstreams/CHANGELOG.md czstreams/tests/homeAssistantAddon.test.ts
git commit -m "feat: expose optional PrehrajTo debug credentials"
```

### Task 2: Parse and map Home Assistant options

**Files:**
- Create: `czstreams/src/homeAssistantConfig.ts`
- Create: `czstreams/tests/homeAssistantConfig.test.ts`

- [x] **Step 1: Write failing parsing and mapping tests**

Create `czstreams/tests/homeAssistantConfig.test.ts` with:

```ts
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

  test.each([
    [{}, {}],
    [{ prehrajto_debug_username: "" }, {}],
    [{ prehrajto_debug_password: "" }, {}],
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

  test.each(["null", "[]", '"value"']) (
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
    const readOptionsFile = vi.fn(async () => '{"prehrajto_debug_password":"p"}');

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
```

- [x] **Step 2: Run the configuration tests and verify they fail**

Run: `npm test -- tests/homeAssistantConfig.test.ts`

Working directory: `czstreams/`

Expected: FAIL because `src/homeAssistantConfig.ts` does not exist.

- [x] **Step 3: Implement the focused configuration boundary**

Create `czstreams/src/homeAssistantConfig.ts` with:

```ts
import { readFile } from "node:fs/promises";

export type HomeAssistantOptions = Record<string, unknown>;
export type HomeAssistantEnvironment = Record<string, string>;
export type ReadOptionsFile = (
  path: string,
  encoding: "utf8",
) => Promise<string>;

export function parseHomeAssistantOptions(json: string): HomeAssistantOptions {
  const options: unknown = JSON.parse(json);
  if (options === null || Array.isArray(options) || typeof options !== "object") {
    throw new Error("Home Assistant options must be a JSON object");
  }
  return options as HomeAssistantOptions;
}

export async function loadHomeAssistantOptions(
  path = "/data/options.json",
  readOptionsFile: ReadOptionsFile = async (optionsPath, encoding) =>
    readFile(optionsPath, encoding),
): Promise<HomeAssistantOptions> {
  try {
    return parseHomeAssistantOptions(await readOptionsFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function getHomeAssistantEnvironment(
  options: HomeAssistantOptions,
): HomeAssistantEnvironment {
  const environment: HomeAssistantEnvironment = {};
  const username = options.prehrajto_debug_username;
  const password = options.prehrajto_debug_password;

  if (typeof username === "string" && username.length > 0) {
    environment.PREHRAJTO_DEBUG_USERNAME = username;
  }
  if (typeof password === "string" && password.length > 0) {
    environment.PREHRAJTO_DEBUG_PASSWORD = password;
  }

  return environment;
}
```

- [x] **Step 4: Run the configuration tests and verify they pass**

Run: `npm test -- tests/homeAssistantConfig.test.ts`

Working directory: `czstreams/`

Expected: all configuration tests pass and no credential value is logged.

- [x] **Step 5: Commit the configuration boundary**

```bash
git add czstreams/src/homeAssistantConfig.ts \
  czstreams/tests/homeAssistantConfig.test.ts
git commit -m "feat: load Home Assistant debug credentials"
```

### Task 3: Start the server through the Home Assistant launcher

**Files:**
- Modify: `czstreams/tests/homeAssistantAddon.test.ts`
- Create: `czstreams/homeAssistant.ts`
- Modify: `czstreams/package.json`
- Modify: `czstreams/Dockerfile`
- Modify: `czstreams/run.sh`
- Modify: `czstreams/tsconfig.json`

- [x] **Step 1: Write the failing launcher packaging assertions**

Add these assertions to the direct-TypeScript test in
`czstreams/tests/homeAssistantAddon.test.ts`:

```ts
    const packageJson = JSON.parse(
      readFileSync(resolve(addonRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(dockerfile).toContain("COPY homeAssistant.ts server.ts addon.ts ./");
    expect(runScript).toContain("exec npm run start:home-assistant");
    expect(packageJson.scripts["start:home-assistant"]).toBe(
      "node --experimental-strip-types homeAssistant.ts",
    );
    expect(tsconfig).toContain('"homeAssistant.ts"');
```

Replace the old Docker copy and `npm run start` assertions so each runtime
contract has only one expected form.

- [x] **Step 2: Run the packaging test and verify it fails**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: FAIL because the launcher, script, Docker copy, and TypeScript include
do not exist yet.

- [x] **Step 3: Create the Home Assistant entry point**

Create `czstreams/homeAssistant.ts` with:

```ts
import {
  getHomeAssistantEnvironment,
  loadHomeAssistantOptions,
} from "./src/homeAssistantConfig.ts";

const options = await loadHomeAssistantOptions();
Object.assign(process.env, getHomeAssistantEnvironment(options));

await import("./server.ts");
```

- [x] **Step 4: Add the production startup script**

Add this property under `scripts` in `czstreams/package.json`:

```json
"start:home-assistant": "node --experimental-strip-types homeAssistant.ts"
```

Replace `czstreams/run.sh` with:

```sh
#!/bin/sh
set -eu

exec npm run start:home-assistant
```

- [x] **Step 5: Package and type-check the launcher**

Change the Dockerfile entry copy to:

```dockerfile
COPY homeAssistant.ts server.ts addon.ts ./
```

Add `homeAssistant.ts` before `addon.ts` in the `include` array of
`czstreams/tsconfig.json`:

```json
"include": [
  "homeAssistant.ts",
  "addon.ts",
  "server.ts",
  "src/**/*",
  "tests/**/*"
]
```

- [x] **Step 6: Run packaging tests and static type checking**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: all packaging tests pass.

Run: `npm run check:tsc`

Working directory: `czstreams/`

Expected: TypeScript exits `0` with no diagnostics.

- [x] **Step 7: Commit launcher wiring**

```bash
git add czstreams/homeAssistant.ts czstreams/package.json \
  czstreams/Dockerfile czstreams/run.sh czstreams/tsconfig.json \
  czstreams/tests/homeAssistantAddon.test.ts
git commit -m "feat: apply Home Assistant options at startup"
```

### Task 4: Preserve the missing-credentials endpoint response

**Files:**
- Create: `czstreams/tests/endpoints/testEndpoint.test.ts`
- Modify: `czstreams/src/endpoints/test.ts`

- [x] **Step 1: Write failing endpoint tests**

Create `czstreams/tests/endpoints/testEndpoint.test.ts` with:

```ts
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
  ])("returns 503 for an incomplete credential pair", async (username, password) => {
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
  });
});
```

- [x] **Step 2: Run the endpoint tests and verify they fail**

Run: `npm test -- tests/endpoints/testEndpoint.test.ts`

Working directory: `czstreams/`

Expected: FAIL because URL construction accesses the guarded Express-only
`protocol` property before checking credentials.

- [x] **Step 3: Move credential validation before query parsing**

At the start of the `try` block in `czstreams/src/endpoints/test.ts`, use this
order:

```ts
    const userName = process.env.PREHRAJTO_DEBUG_USERNAME;
    const password = process.env.PREHRAJTO_DEBUG_PASSWORD;
    if (!userName || !password) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "PREHRAJTO_DEBUG_USERNAME and PREHRAJTO_DEBUG_PASSWORD are required" +
          NL,
      );
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const term = url.searchParams.get("q");
    const breakpoint = url.searchParams.get("breakpoint");
```

Remove the previous duplicate environment lookup and missing-credential block.

- [x] **Step 4: Run endpoint and full tests**

Run: `npm test -- tests/endpoints/testEndpoint.test.ts`

Working directory: `czstreams/`

Expected: all three endpoint cases pass without contacting PrehrajTo.

Run: `npm test`

Working directory: `czstreams/`

Expected: the complete suite passes.

- [x] **Step 5: Commit endpoint compatibility**

```bash
git add czstreams/src/endpoints/test.ts \
  czstreams/tests/endpoints/testEndpoint.test.ts
git commit -m "fix: preserve missing debug credential response"
```

### Task 5: Document and verify the add-on update

**Files:**
- Modify: `czstreams/DOCS.md`
- Create: `docs/superpowers/plans/2026-07-31-home-assistant-debug-credentials.md`

- [x] **Step 1: Document the optional fields**

Insert this section after the manifest URL in `czstreams/DOCS.md`:

```markdown
## Optional test endpoint credentials

The add-on configuration includes optional **PrehrajTo debug username** and
**PrehrajTo debug password** fields. They are used only by the `/test` endpoint;
normal Stremio resolver credentials are still configured through CzStreams in
Stremio.

If either field is empty, CzStreams starts normally and `/test` returns a `503`
response explaining that both debug environment variables are required.
```

- [x] **Step 2: Run the complete project check**

Run: `npm run check`

Working directory: `czstreams/`

Expected: TypeScript, ESLint, and the complete Vitest suite exit `0`.

- [x] **Step 3: Build the updated add-on image**

Run:

```bash
docker build \
  --build-arg BUILD_VERSION=0.1.12 \
  --build-arg BUILD_ARCH=amd64 \
  --tag czstreams-home-assistant:debug-credentials \
  .
```

Working directory: `czstreams/`

Expected: Docker exits `0` with the updated image.

- [x] **Step 4: Start a temporary unconfigured container**

Run:

```bash
docker run --detach --rm \
  --name czstreams-debug-credentials-smoke \
  --publish 15293:52932 \
  czstreams-home-assistant:debug-credentials
```

Expected: Docker prints a container ID and the missing `/data/options.json`
does not prevent startup.

- [x] **Step 5: Verify the manifest and missing-credential response**

Run:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:15293/manifest.json
```

Expected: JSON containing `"version":"0.1.12"`.

Run:

```bash
curl --silent --show-error \
  --output /tmp/czstreams-debug-response.txt \
  --write-out '%{http_code}' \
  http://127.0.0.1:15293/test/
```

Expected: output `503` and `/tmp/czstreams-debug-response.txt` contains
`PREHRAJTO_DEBUG_USERNAME and PREHRAJTO_DEBUG_PASSWORD are required`.

- [x] **Step 6: Stop the temporary container**

Run: `docker stop czstreams-debug-credentials-smoke`

Expected: Docker stops and removes the `--rm` container.

- [x] **Step 7: Validate and commit documentation and plan**

Run: `git diff --check`

Expected: exit `0`.

```bash
git add czstreams/DOCS.md \
  docs/superpowers/plans/2026-07-31-home-assistant-debug-credentials.md
git commit -m "docs: explain optional debug credentials"
```
