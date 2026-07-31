# Home Assistant Add-on Design

## Goal

Package CzStreams as a Home Assistant add-on that users can install by adding
this GitHub repository to the Home Assistant Add-on Store. The add-on runs the
existing Stremio server on the Home Assistant host and exposes its manifest over
the local network.

## Repository layout

The repository will follow Home Assistant's single-add-on repository layout:

```text
repository.yaml
README.md
czstreams/
  .dockerignore
  config.yaml
  Dockerfile
  DOCS.md
  CHANGELOG.md
  run.sh
  package.json
  package-lock.json
  tsconfig.json
  eslint.config.js
  vitest.config.ts
  server.ts
  addon.ts
  src/
  tests/
```

`repository.yaml` and the repository-level README remain at the root. The
application, its development configuration, its tests, and all files needed by
the Docker build move into `czstreams/`. Keeping the application self-contained
is necessary because Home Assistant builds an add-on using its add-on directory
as the Docker build context.

The existing untracked root-level add-on draft files will be replaced by the
files under `czstreams/`; there will be only one copy of each application or
packaging file.

## Add-on configuration

`czstreams/config.yaml` will declare:

- name and slug for CzStreams;
- version `0.1.11`, matching the current package version;
- `amd64` and `aarch64` support;
- automatic boot with application-level startup;
- container port `52932/tcp`, mapped by default to host port `52932`; and
- a direct Web UI URL using Home Assistant's host and effective port
  placeholders.

The add-on will use empty `options` and `schema` objects. Users can change the
host-side port through the Network section of the Home Assistant add-on UI, but
the server continues to listen on port `52932` inside the container.

The optional service-proxy and debugging environment variables are not exposed
as Home Assistant add-on options. With no proxy token configured, the main
CzStreams server remains operational and the optional internal relay endpoint
remains disabled under its existing behavior.

Home Assistant ingress will not be enabled. Stremio clients need a stable,
directly reachable URL rather than an authenticated and path-rewriting ingress
URL.

## Container runtime

The Dockerfile will use `node:24-alpine` as its explicit base image and will
declare the Home Assistant build arguments and image labels. It will:

1. set `/app` as the working directory;
2. install production dependencies with `npm ci --omit=dev`;
3. copy `server.ts`, `addon.ts`, and `src/` into the image;
4. copy and install a small executable `run.sh` entrypoint;
5. set production environment defaults, including internal port `52932`; and
6. start the existing TypeScript server directly with Node 24.

There is no TypeScript transpilation stage. Node 24's native type stripping is
the production execution model, matching the existing local `npm start`
behavior. Static type checking remains a development and verification step.

The container receives normal termination signals through `exec` in `run.sh`.
If Node cannot start the server, the process exits nonzero so Home Assistant
Supervisor can report and apply its configured restart behavior.

## User flow

1. The user adds the GitHub repository URL to the Home Assistant Add-on Store.
2. The user installs CzStreams and optionally changes the host port in the
   add-on's Network settings.
3. The user starts the add-on.
4. The user opens the direct add-on URL or constructs the manifest URL as
   `http://<home-assistant-host>:<mapped-port>/manifest.json`.
5. Stremio loads the existing CzStreams configuration flow and stores resolver
   credentials in the Stremio add-on configuration URL, not in Home Assistant.

The repository README will explain repository installation. `czstreams/DOCS.md`
will explain startup, network configuration, the manifest URL, and the fact that
CzStreams credentials are configured from Stremio.

## Error handling

- Dependency installation failures fail the Docker build.
- A missing or malformed runtime source file fails container startup.
- Server startup failures are logged and result in a nonzero process exit.
- The normal add-on remains usable without service-proxy configuration; requests
  to the disabled optional proxy retain the application's existing error
  response.
- Incorrect host-port selection is documented as a connectivity issue and does
  not change the container's internal listening port.

## Testing and verification

Implementation will preserve the current application tests and add focused
packaging checks. Verification will include:

- a test that parses `repository.yaml` and `czstreams/config.yaml` and checks the
  repository layout, required metadata, supported architectures, empty options,
  and port mapping;
- a test that ensures the Dockerfile includes all runtime entry files and uses
  the intended Node 24 direct-TypeScript startup contract;
- `npm test` for all existing and new tests;
- `npm run check:tsc` for static type checking;
- `npm run check:lint` for linting;
- a Docker image build when Docker is available; and
- a container smoke test that waits for and fetches `/manifest.json` through the
  mapped port.

The smoke test will use a temporary container name and host port, will inspect
startup logs on failure, and will remove the container after the check.

## Scope boundaries

This change does not publish a prebuilt image, add GitHub release automation,
enable Home Assistant ingress, expose service-proxy options, change resolver
behavior, or modify the Stremio configuration model. Those can be considered in
separate changes if they become necessary.
