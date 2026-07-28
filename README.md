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

`npm test` runs the Vitest utility, PrehrajTo fixture, endpoint, and proxy-adapter tests. The PrehrajTo fixture tests use checked-in HTML snapshots and the proxy tests use local fakes; neither contacts the live service.

The fixture provenance and refresh policy are documented in `tests/fixtures/prehrajto/README.md`.

## Home Assistant HTTP egress proxy

CzStreams can optionally send PrehrajTo control-plane requests through the HTTP Egress Proxy add-on running on Home Assistant. This is useful when PrehrajTo must see requests originating from the home connection.

The proxy is optional. Leave both configuration fields empty for direct operation. To enable it:

1. Install and start the Home Assistant HTTP Egress Proxy add-on.
2. Configure its `allowed_hosts` with the exact hostname `prehraj.to` and set a long, random `api_key`.
3. Publish the add-on through a protected Cloudflare Tunnel or equivalent HTTPS endpoint. Do not expose port 3000 directly.
4. On the CzStreams configuration page, set **HTTP egress proxy URL** to the public endpoint ending in `/proxy` and **HTTP egress proxy API key** to the same key.

Example Home Assistant add-on configuration:

```yaml
api_key: "replace-with-a-long-random-secret"
allowed_hosts:
  - prehraj.to
timeout_seconds: 30
```

The two CzStreams fields are a pair: configuring only one fails closed instead of falling back to direct PrehrajTo traffic. Runtime proxy URLs must use HTTPS, have no credentials, port, query, or fragment, and have the exact path `/proxy`. The add-on validates and pins a globally routable resolved address while retaining the hostname for TLS.

Only PrehrajTo anonymous-session, login, search, and detail-page requests use this proxy. Cinemeta and TMDB requests remain direct. Final video requests, range requests, and subtitle traffic also remain direct; the proxy never receives or streams media.

### `/test` diagnostics

The `/test` endpoint can exercise real account credentials and accepts a one-off proxy destination, so it is disabled unless a dedicated bearer token and the debug account are configured in the process environment:

```dotenv
TEST_ENDPOINT_BEARER_TOKEN=<long-random-diagnostic-token>
PREHRAJTO_DEBUG_USERNAME=<account-email>
PREHRAJTO_DEBUG_PASSWORD=<account-password>
```

Use a long, random token created only for this endpoint; do not reuse the HTTP egress proxy API key. Send it in the `Authorization` header on every request. Direct diagnostics need no proxy parameters:

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $TEST_ENDPOINT_BEARER_TOKEN" \
  "https://addon.example/test/?q=Movie"
```

For a temporary proxied diagnostic, pass both settings:

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $TEST_ENDPOINT_BEARER_TOKEN" \
  "https://addon.example/test/?q=Movie&proxyUrl=https%3A%2F%2Fproxy.example.com%2Fproxy&proxyApiKey=replace-with-key"
```

The existing `breakpoint=0`, `breakpoint=1`, and `breakpoint=2` parameters remain available. Even in proxied mode, `/test` performs its final media range request directly.

Missing endpoint configuration returns 503, missing or incorrect bearer authorization returns 401, and incomplete or invalid proxy parameters return 400. Authentication and proxy validation happen before any PrehrajTo request.

Putting an API key in a URL can expose it through browser history, copied links, access logs, analytics, CDN logs, and reverse-proxy logs. Prefer the configuration page for normal use. When using `/test`, keep the URL short-lived, avoid sharing it, ensure query strings are redacted from every logging layer, and rotate the key immediately if disclosure is suspected. `/test` responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and diagnostic output does not include query strings or credentials.
