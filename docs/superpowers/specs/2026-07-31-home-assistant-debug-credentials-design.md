# Home Assistant Debug Credentials Design

## Goal

Allow Home Assistant users to optionally configure the PrehrajTo credentials
used by CzStreams' `/test` endpoint. When either credential is absent, the
add-on continues to start normally and the endpoint retains its existing `503`
response and error message.

## Add-on configuration

`czstreams/config.yaml` will add two optional fields without defaults:

```yaml
options: {}
schema:
  prehrajto_debug_username: str?
  prehrajto_debug_password: password?
```

The lowercase keys follow Home Assistant option conventions. The `password`
schema type masks the password in the add-on configuration UI. Omitting either
field is valid and does not prevent installation or startup.

The add-on and package versions will be incremented together from `0.1.11` to
`0.1.12` so Home Assistant detects the updated configuration. The changelog
will record the new optional settings.

## Configuration loading

A focused `src/homeAssistantConfig.ts` module will own the Home Assistant
configuration boundary. It will:

- read `/data/options.json` as UTF-8 JSON;
- treat a missing file as an empty options object so the image remains usable
  in direct Docker smoke tests;
- reject malformed JSON and non-object JSON values so corrupted Supervisor
  configuration fails startup visibly;
- copy a non-empty string `prehrajto_debug_username` to
  `PREHRAJTO_DEBUG_USERNAME`;
- copy a non-empty string `prehrajto_debug_password` to
  `PREHRAJTO_DEBUG_PASSWORD`; and
- leave each environment variable unset when its option is absent or empty.

The module will not log option values. It will expose pure parsing and mapping
functions so credential behavior can be tested without starting the HTTP
server.

## Startup flow

A small `homeAssistant.ts` entry point will load and apply Home Assistant
options before dynamically importing `server.ts`. The production `run.sh` will
invoke a dedicated `npm run start:home-assistant` script, while the existing
`npm start` command remains the local-development entry point.

```text
/data/options.json
        |
        v
homeAssistant.ts -> process.env -> server.ts -> /test endpoint
```

Node 24 will continue to run TypeScript directly; no transpilation step or new
runtime package is required. The Dockerfile already copies `src/`, so the only
additional root-level runtime file to copy is `homeAssistant.ts`.

## Test endpoint behavior

The endpoint will continue reading `PREHRAJTO_DEBUG_USERNAME` and
`PREHRAJTO_DEBUG_PASSWORD`. Its missing-credential check will run before query
parsing, guaranteeing that an unset or partially configured pair returns:

```text
PREHRAJTO_DEBUG_USERNAME and PREHRAJTO_DEBUG_PASSWORD are required
```

with HTTP status `503`.

The endpoint only needs the request path and query string. It will parse these
against a fixed local base URL rather than depending on Express-only
`req.protocol` and `req.hostname` properties, because the server's custom-route
wrapper receives Node HTTP request objects.

## Error handling and security

- Missing `/data/options.json`: continue with no debug credentials.
- Missing or empty username/password: leave that environment variable unset.
- Only one configured value: start normally; `/test` returns the same `503`
  missing-credentials response.
- Malformed or non-object options JSON: fail container startup with a sanitized
  parsing error.
- Credential values never appear in application logs, startup logs, tests, or
  error messages.

These credentials are intentionally limited to the debug endpoint. They do not
replace the resolver credentials supplied through Stremio's configuration URL.

## Testing and verification

Test-first implementation will cover:

- optional Home Assistant schema fields and the masked password type;
- mapping both configured values to the existing uppercase environment names;
- preserving exact credential values without logging them;
- absent, empty, and partially configured options;
- missing options file fallback;
- malformed and non-object options failures;
- the `/test` endpoint's unchanged `503` status and message without a complete
  credential pair;
- direct TypeScript startup through the Home Assistant launcher;
- the complete TypeScript, ESLint, and Vitest suite; and
- a rebuilt container smoke test confirming the manifest still responds and
  `/test` returns the expected missing-credentials error without configuration.

## Scope boundaries

This change does not expose the service-proxy settings, validate credentials at
container startup, contact PrehrajTo during configuration, add a secrets store,
or change Stremio's resolver configuration model.
