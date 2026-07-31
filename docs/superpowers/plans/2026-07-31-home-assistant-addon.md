# Home Assistant Add-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repository into a Home Assistant add-on repository that builds and runs the existing CzStreams Stremio server on a user-configurable host port.

**Architecture:** Keep repository metadata and installation guidance at the root, and move the complete Node application into a self-contained `czstreams/` add-on directory. Home Assistant builds a single-stage Node 24 Alpine image that installs production dependencies and runs the TypeScript entry point directly; add-on configuration exposes only the standard network port mapping.

**Tech Stack:** Home Assistant add-on metadata, Docker, Node.js 24 native TypeScript type stripping, npm, TypeScript, Vitest, ESLint, YAML

---

## File structure

- `repository.yaml`: identifies the GitHub repository to Home Assistant.
- `README.md`: explains adding the repository and links to add-on usage and development documentation.
- `czstreams/config.yaml`: defines Home Assistant metadata and the `52932/tcp` network mapping.
- `czstreams/Dockerfile`: creates the production Node 24 image.
- `czstreams/run.sh`: forwards container signals to the existing npm start command.
- `czstreams/DOCS.md`: explains add-on installation, networking, and Stremio setup.
- `czstreams/CHANGELOG.md`: records the initial Home Assistant packaging release.
- `czstreams/README.md`: preserves the existing application and service-proxy development documentation.
- `czstreams/package.json` and `czstreams/package-lock.json`: define runtime, development, and YAML test-parser dependencies.
- `czstreams/server.ts`: starts the Stremio SDK server and installs existing custom routes.
- `czstreams/src/startup.ts`: contains independently testable fatal-startup handling.
- `czstreams/tests/homeAssistantAddon.test.ts`: validates repository metadata and container packaging contracts.
- `czstreams/tests/startup.test.ts`: verifies fatal startup failures produce a nonzero exit status.
- `czstreams/src/`, `czstreams/tests/`, and tool configuration files: retain existing application behavior and verification.

### Task 1: Make the application a self-contained add-on directory

**Files:**
- Move: `.env.example` to `czstreams/.env.example`
- Move: `.nvmrc` to `czstreams/.nvmrc`
- Move: `.prettierrc` to `czstreams/.prettierrc`
- Move: `README.md` to `czstreams/README.md`
- Move: `addon.ts` to `czstreams/addon.ts`
- Move: `server.ts` to `czstreams/server.ts`
- Move: `eslint.config.js` to `czstreams/eslint.config.js`
- Move: `package.json` to `czstreams/package.json`
- Move: `package-lock.json` to `czstreams/package-lock.json`
- Move: `tsconfig.json` to `czstreams/tsconfig.json`
- Move: `vitest.config.ts` to `czstreams/vitest.config.ts`
- Move: `src/` to `czstreams/src/`
- Move: `tests/` to `czstreams/tests/`
- Move: `.dockerignore` to `czstreams/.dockerignore`
- Move: `Dockerfile` to `czstreams/Dockerfile`
- Move: `config.yaml` to `czstreams/config.yaml`
- Move: `run.sh` to `czstreams/run.sh`

- [x] **Step 1: Create the add-on directory and move tracked application files**

```bash
mkdir -p czstreams
git mv .env.example .nvmrc .prettierrc README.md addon.ts server.ts \
  eslint.config.js package.json package-lock.json tsconfig.json \
  vitest.config.ts src tests czstreams/
```

- [x] **Step 2: Move the user's untracked packaging draft without changing its contents**

Move `.dockerignore`, `Dockerfile`, `config.yaml`, and `run.sh` into
`czstreams/`. Keep `repository.yaml` at the repository root. Confirm there are
no remaining duplicate packaging files at the root.

- [x] **Step 3: Install dependencies in the new working directory**

Run: `npm ci`

Working directory: `czstreams/`

Expected: npm exits `0` and creates `czstreams/node_modules/`.

- [x] **Step 4: Verify the move preserved application behavior**

Run: `npm test`

Working directory: `czstreams/`

Expected: all existing Vitest tests pass.

Run: `npm run check:tsc`

Working directory: `czstreams/`

Expected: TypeScript exits `0` with no diagnostics.

- [x] **Step 5: Commit the structural move**

```bash
git add -A -- czstreams .env.example .nvmrc .prettierrc README.md addon.ts \
  server.ts eslint.config.js package.json package-lock.json tsconfig.json \
  vitest.config.ts src tests
git commit -m "refactor: place CzStreams in add-on directory"
```

### Task 2: Define and test Home Assistant metadata

**Files:**
- Modify: `repository.yaml`
- Modify: `czstreams/config.yaml`
- Modify: `czstreams/package.json`
- Modify: `czstreams/package-lock.json`
- Create: `czstreams/tests/homeAssistantAddon.test.ts`

- [x] **Step 1: Add the YAML parser used only by packaging tests**

Run: `npm install --save-dev yaml`

Working directory: `czstreams/`

Expected: `yaml` appears in `devDependencies` and the lockfile is updated.

- [x] **Step 2: Write the failing metadata tests**

Create `czstreams/tests/homeAssistantAddon.test.ts` with:

```ts
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
```

- [x] **Step 3: Run the metadata tests and verify they fail for the draft configuration**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: FAIL because the draft repository name, add-on slug, architectures,
options, or schema do not match the approved design.

- [x] **Step 4: Replace the repository metadata**

Replace `repository.yaml` with:

```yaml
name: CzStreams Home Assistant Add-on
url: https://github.com/lukaskral/stremio-plugin-prehrajto
maintainer: Lukas Kral
```

- [x] **Step 5: Replace the add-on configuration**

Replace `czstreams/config.yaml` with:

```yaml
name: CzStreams
version: "0.1.11"
slug: czstreams
description: Czech and Slovak streams for Stremio
url: https://github.com/lukaskral/stremio-plugin-prehrajto
startup: application
boot: auto
init: false

arch:
  - amd64
  - aarch64

ports:
  52932/tcp: 52932
ports_description:
  52932/tcp: CzStreams Stremio add-on
webui: http://[HOST]:[PORT:52932]/

options: {}
schema: {}
```

- [x] **Step 6: Run the metadata tests and verify they pass**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: 3 tests pass.

- [x] **Step 7: Commit the metadata contract**

```bash
git add repository.yaml czstreams/config.yaml czstreams/package.json \
  czstreams/package-lock.json czstreams/tests/homeAssistantAddon.test.ts
git commit -m "feat: define Home Assistant add-on metadata"
```

### Task 3: Package the direct-TypeScript Node runtime

**Files:**
- Modify: `czstreams/tests/homeAssistantAddon.test.ts`
- Modify: `czstreams/Dockerfile`
- Modify: `czstreams/.dockerignore`
- Modify: `czstreams/run.sh`
- Modify: `czstreams/tsconfig.json`

- [x] **Step 1: Write the failing container-contract test**

Append this test inside the existing `describe` block in
`czstreams/tests/homeAssistantAddon.test.ts`:

```ts
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
```

- [x] **Step 2: Run the test and verify it fails against the draft Dockerfile**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: FAIL because the draft uses the Home Assistant base image, omits
runtime entry files, and lacks explicit image labels.

- [x] **Step 3: Replace the Dockerfile with the direct-TypeScript image**

Replace `czstreams/Dockerfile` with:

```dockerfile
FROM node:24-alpine

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.ts addon.ts ./
COPY src ./src
COPY run.sh /run.sh

RUN chmod 0755 /run.sh

ENV NODE_ENV=production
ENV PORT=52932

EXPOSE 52932

CMD ["/run.sh"]
```

- [x] **Step 4: Replace the entrypoint with a signal-forwarding POSIX script**

Replace `czstreams/run.sh` with:

```sh
#!/bin/sh
set -eu

exec npm run start
```

Set its executable bit:

Run: `chmod 0755 run.sh`

Working directory: `czstreams/`

- [x] **Step 5: Limit the Docker build context**

Replace `czstreams/.dockerignore` with:

```text
node_modules
npm-debug.log*
.env
.env.*
.git
.gitignore
tests
docs
README.md
DOCS.md
CHANGELOG.md
eslint.config.js
tsconfig.json
vitest.config.ts
```

- [x] **Step 6: Include both runtime entry points in static type checking**

Replace the `include` property in `czstreams/tsconfig.json` with:

```json
"include": [
  "addon.ts",
  "server.ts",
  "src/**/*",
  "tests/**/*"
]
```

- [x] **Step 7: Run the container-contract tests and verify they pass**

Run: `npm test -- tests/homeAssistantAddon.test.ts`

Working directory: `czstreams/`

Expected: 4 tests pass.

- [x] **Step 8: Commit the runtime packaging**

```bash
git add czstreams/Dockerfile czstreams/.dockerignore czstreams/run.sh \
  czstreams/tsconfig.json czstreams/tests/homeAssistantAddon.test.ts
git commit -m "feat: package CzStreams for Home Assistant"
```

### Task 4: Make startup failures fatal to the container

**Files:**
- Create: `czstreams/src/startup.ts`
- Create: `czstreams/tests/startup.test.ts`
- Modify: `czstreams/server.ts`

- [x] **Step 1: Write the failing startup test**

Create `czstreams/tests/startup.test.ts` with:

```ts
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
```

- [x] **Step 2: Run the startup test and verify it fails because the helper is missing**

Run: `npm test -- tests/startup.test.ts`

Working directory: `czstreams/`

Expected: FAIL because `src/startup.ts` cannot be imported.

- [x] **Step 3: Implement the startup helper**

Create `czstreams/src/startup.ts` with:

```ts
type StartServer = () => Promise<void>;
type LogError = (message: string, error: unknown) => void;

export async function runWithStartupHandling(
  startServer: StartServer,
  logError: LogError = console.error,
): Promise<void> {
  try {
    await startServer();
  } catch (error) {
    logError("Failed to start server:", error);
    process.exitCode = 1;
  }
}
```

- [x] **Step 4: Run the startup test and verify the helper passes**

Run: `npm test -- tests/startup.test.ts`

Working directory: `czstreams/`

Expected: 2 tests pass.

- [x] **Step 5: Route server startup through the tested helper**

Add this import to `czstreams/server.ts`:

```ts
import { runWithStartupHandling } from "./src/startup.ts";
```

Replace the existing `serveHTTP(...).then(...).catch(...)` block with:

```ts
void runWithStartupHandling(async () => {
  const { server } = await serveHTTP(addonInterface, {
    port: process.env.PORT ? Number(process.env.PORT) : 52932,
  });

  const originalListeners = server.listeners("request").slice();

  server.removeAllListeners("request");
  server.on("request", async (req: Request, res: Response) => {
    try {
      if (req.url && req.url.split("?", 1)[0] === "/internal/service-proxy") {
        await serviceProxyHandler(req, res);
        return;
      }

      if (req.url && req.url.startsWith("/media/")) {
        await mediaHandler(req, res);
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

      for (const listener of originalListeners) {
        listener.call(server, req, res);
      }
    } catch (error) {
      console.error(`Error on request ${req.url}`, error);
    }
  });
});
```

- [x] **Step 6: Run startup and full application tests**

Run: `npm test -- tests/startup.test.ts`

Working directory: `czstreams/`

Expected: 2 tests pass.

Run: `npm test`

Working directory: `czstreams/`

Expected: all Vitest tests pass.

- [x] **Step 7: Commit fatal startup handling**

```bash
git add czstreams/server.ts czstreams/src/startup.ts \
  czstreams/tests/startup.test.ts
git commit -m "fix: fail the add-on when server startup fails"
```

### Task 5: Document installation and use

**Files:**
- Create: `README.md`
- Create: `czstreams/DOCS.md`
- Create: `czstreams/CHANGELOG.md`
- Modify: `czstreams/README.md`

- [x] **Step 1: Create the repository installation guide**

Create `README.md` with:

````markdown
# CzStreams Home Assistant Add-on

This repository packages the CzStreams Stremio add-on for Home Assistant.

## Install

1. In Home Assistant, open **Settings → Add-ons → Add-on Store**.
2. Open the repositories menu and add:
   `https://github.com/lukaskral/stremio-plugin-prehrajto`
3. Install **CzStreams**.
4. If necessary, change its host port under **Network**. The default is `52932`.
5. Start the add-on.

Install the Stremio manifest from:

```text
http://<home-assistant-host>:52932/manifest.json
```

Replace `52932` when you selected a different host port. Resolver credentials
are configured through CzStreams in Stremio, not in the Home Assistant add-on.

See [`czstreams/DOCS.md`](czstreams/DOCS.md) for usage and troubleshooting.
Application development and service-proxy details remain in
[`czstreams/README.md`](czstreams/README.md).
````

- [x] **Step 2: Create the installed add-on documentation**

Create `czstreams/DOCS.md` with:

````markdown
# CzStreams

CzStreams provides Czech and Slovak media streams to Stremio. Home Assistant
runs the CzStreams server; playback and resolver configuration remain in
Stremio.

## Start the add-on

The server listens on container port `52932`. Home Assistant maps this to host
port `52932` by default. You can choose a different host port in the add-on's
**Network** settings before starting it.

After startup, open:

```text
http://<home-assistant-host>:<mapped-port>/manifest.json
```

Use the IP address or hostname that your Stremio device uses to reach Home
Assistant. Configure PrehrajTo credentials through the CzStreams page presented
by Stremio; this add-on has no Home Assistant configuration options.

## Troubleshooting

- Confirm the add-on is running and inspect its log for startup errors.
- Confirm the selected host port is not already used by another service.
- Test the manifest URL from the same device or network as Stremio.
- Use the mapped host port in the URL, not necessarily the internal port
  `52932`.
- Home Assistant ingress is intentionally unavailable because Stremio needs a
  directly reachable manifest URL.
````

- [x] **Step 3: Record the add-on release**

Create `czstreams/CHANGELOG.md` with:

```markdown
# Changelog

## 0.1.11

- Package CzStreams as a Home Assistant add-on.
- Support `amd64` and `aarch64` installations.
- Expose the Stremio server through Home Assistant's network port settings.
```

- [x] **Step 4: Add a Home Assistant development note to the application README**

Insert this paragraph after the opening description in `czstreams/README.md`:

```markdown
The application lives in the `czstreams/` directory because that directory is
also the Home Assistant Docker build context. Run all npm development commands
from this directory. Home Assistant installation instructions are in the
repository-level README.
```

- [x] **Step 5: Check documentation links and formatting**

Run: `git diff --check`

Expected: exit `0` with no whitespace errors.

Run: `test -f README.md && test -f czstreams/DOCS.md && test -f czstreams/CHANGELOG.md`

Expected: exit `0`.

- [x] **Step 6: Commit documentation**

```bash
git add README.md czstreams/README.md czstreams/DOCS.md \
  czstreams/CHANGELOG.md
git commit -m "docs: explain Home Assistant installation"
```

### Task 6: Run complete verification and smoke-test the image

**Files:**
- Modify only if verification reveals an in-scope defect.

- [x] **Step 1: Run the complete project check**

Run: `npm run check`

Working directory: `czstreams/`

Expected: TypeScript, ESLint, and all Vitest tests exit `0` with no errors.

- [x] **Step 2: Validate the final diff**

Run: `git diff --check HEAD~5..HEAD`

Expected: exit `0` with no whitespace errors.

Run: `git status --short`

Expected: only the implementation plan may remain untracked or modified; no
application changes remain uncommitted.

- [x] **Step 3: Build the Home Assistant image**

Run:

```bash
docker build \
  --build-arg BUILD_VERSION=0.1.11 \
  --build-arg BUILD_ARCH=amd64 \
  --tag czstreams-home-assistant:test \
  .
```

Working directory: `czstreams/`

Expected: Docker exits `0`; the final image is tagged
`czstreams-home-assistant:test`.

- [x] **Step 4: Start a temporary smoke-test container**

Run:

```bash
docker run --detach --rm \
  --name czstreams-home-assistant-smoke \
  --publish 15293:52932 \
  czstreams-home-assistant:test
```

Expected: Docker prints a container ID.

- [x] **Step 5: Verify the manifest endpoint**

Run up to ten times, with a one-second interval between attempts:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:15293/manifest.json
```

Expected: exit `0` and a JSON Stremio manifest containing
`"id":"community.czstreams"`.

If it does not respond, run
`docker logs czstreams-home-assistant-smoke` and report the actual startup
failure before changing code.

- [x] **Step 6: Remove the smoke-test container**

Run: `docker stop czstreams-home-assistant-smoke`

Expected: Docker prints `czstreams-home-assistant-smoke`. Because the container
was started with `--rm`, Docker also removes it.

- [x] **Step 7: Commit the implementation plan if it is not already committed**

```bash
git add docs/superpowers/plans/2026-07-31-home-assistant-addon.md
git commit -m "docs: plan Home Assistant add-on implementation"
```
