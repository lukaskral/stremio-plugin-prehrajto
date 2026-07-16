# CzStreams Stremio addon

CzStreams is a small Stremio addon that finds Czech and Slovak media from supported online storage services. It currently enables the PrehrajTo resolver.

The project requires Node.js 24.

## Development

```bash
npm install
npm start
```

Run deterministic tests and static checks with:

```bash
npm test
npm run check
```

The previous live PrehrajTo smoke test remains available separately:

```bash
npm run test:live
```

That command contacts external services and may consume account or network resources. The normal `npm test` command uses local fakes and does not require PrehrajTo credentials.

## Service proxy

The service proxy is an optional debugging relay. It lets a local addon send PrehrajTo login, search, and detail-page requests through the deployed addon server. This helps reproduce failures that depend on the deployment's source network.

Direct mode remains the default. If `SERVICE_PROXY_URL` and `SERVICE_PROXY_CLIENT_TOKEN` are absent, storage requests leave the current process normally.

The relay does not proxy final media URLs, video downloads, subtitle downloads, TMDB calls, or arbitrary internet traffic. Stremio continues to contact the returned media URL directly.

### Configure the deployed server

Generate a dedicated secret using a password manager or:

```bash
openssl rand -hex 32
```

Configure the deployed addon process:

```dotenv
SERVICE_PROXY_TOKEN=<generated-secret>
SERVICE_PROXY_ALLOWED_HOSTS=prehraj.to
SERVICE_PROXY_DEBUG=false
```

`SERVICE_PROXY_TOKEN` is required for `/internal/service-proxy`. When it is absent, the endpoint returns `503 PROXY_DISABLED` and makes no outbound request.

`SERVICE_PROXY_ALLOWED_HOSTS` is a comma-separated list of exact hostnames. It defaults to `prehraj.to`. Add a hostname only when a supported storage resolver needs it; suffix matches and arbitrary URLs are not accepted.

The deployed addon should not set `SERVICE_PROXY_URL`. Its own resolver traffic therefore remains direct while the authenticated relay endpoint is available to your local instance.

### Configure the local client

Set both client values before starting the local addon:

```dotenv
SERVICE_PROXY_URL=https://your-deployed-addon.example/internal/service-proxy
SERVICE_PROXY_CLIENT_TOKEN=<same-generated-secret>
```

The value of `SERVICE_PROXY_CLIENT_TOKEN` must equal the deployed server's `SERVICE_PROXY_TOKEN`. The names differ deliberately: this prevents a server-only token from accidentally enabling client proxy mode on the deployment.

Both client variables must be present together. Partial configuration fails immediately with a descriptive error. The relay URL must use HTTPS, except for loopback URLs used by automated tests.

For example, on macOS the secret can remain in Keychain instead of a shell-history command:

```bash
SERVICE_PROXY_URL="https://your-deployed-addon.example/internal/service-proxy" \
SERVICE_PROXY_CLIENT_TOKEN="$(security find-generic-password -w -s stremio-service-proxy)" \
npm start
```

Do not commit a populated `.env` file. Local `.env*` files are ignored, while `.env.example` documents variable names without real credentials.

### Relay security and limits

The endpoint requires a bearer token and compares it using a constant-time operation. It accepts only serialized `GET`, `HEAD`, and `POST` upstream requests. Targets must use HTTPS, have no embedded credentials, use port 443, and match the exact hostname allowlist. Every redirect is checked again before it is followed.

The relay is intentionally buffered and unsuitable for media:

- endpoint JSON envelope: 512 KiB maximum;
- decoded upstream request body: 256 KiB maximum;
- upstream response body: 5 MiB maximum;
- upstream timeout: 15 seconds; and
- redirects: 5 maximum.

Hop-by-hop headers are removed. Relay authorization is never forwarded upstream.

### Diagnostics

Every successful proxy request logs a sanitized summary containing its request ID, method, hostname, pathname, status, duration, and byte counts. Errors include a stable code and request ID. Query strings, cookies, authorization headers, request bodies, and response bodies are never logged.

Set `SERVICE_PROXY_DEBUG=true` temporarily to add sanitized redirect lifecycle logs. Debug mode still does not log headers, bodies, or query strings. Set it back to `false` after investigation.

The `/test` endpoint no longer contains account credentials. To use it, provide secrets only through the process environment:

```dotenv
PREHRAJTO_DEBUG_USERNAME=<account-email>
PREHRAJTO_DEBUG_PASSWORD=<account-password>
```

Its final range request goes directly to the resolved media URL by design; it does not pass through the service proxy.

### Troubleshooting

- `401 UNAUTHORIZED`: the local client token is missing or does not match the deployed `SERVICE_PROXY_TOKEN`.
- `403 FORBIDDEN_DESTINATION` or `FORBIDDEN_METHOD`: the target hostname, protocol, port, credentials, redirect, or method violates the relay policy. Check the exact hostname allowlist before adding anything.
- `413 REQUEST_TOO_LARGE`: the serialized request or decoded body exceeded its control-plane limit. Media requests are not supported.
- `502 UPSTREAM_FAILURE`, `RESPONSE_TOO_LARGE`, or `TOO_MANY_REDIRECTS`: the deployed server could not complete the allowlisted upstream request within relay policy.
- `503 PROXY_DISABLED`: `SERVICE_PROXY_TOKEN` is not configured on the deployed server.
- `504 UPSTREAM_TIMEOUT`: the storage service did not respond within 15 seconds from the deployed network.

Use the request ID from the local error to find the corresponding sanitized server log.

## Manual verification

First start the addon without the two client proxy variables and verify normal direct behavior:

```bash
PREHRAJTO_DEBUG_USERNAME="<account-email>" \
PREHRAJTO_DEBUG_PASSWORD="<account-password>" \
npm start
```

Then deploy the server token and start the local addon with `SERVICE_PROXY_URL` and `SERVICE_PROXY_CLIENT_TOKEN`. Exercise login, search, and detail resolution. The deployed logs should show sanitized requests to `prehraj.to`; the returned media URL should still point at the storage provider rather than `/internal/service-proxy`.
