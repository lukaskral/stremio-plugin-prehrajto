# Request-Scoped Server Origin Design

## Goal

Replace the hard-coded deployment URL returned by `getServerUrl()` with the
public origin of the HTTP request that asked CzStreams for streams. Generated
`/media/...` URLs must use the same scheme, hostname, and external port that
Stremio used, whether it connected directly or through a trusted reverse proxy.

For example:

- a request to `http://homeassistant.local:52932/...` produces media URLs under
  `http://homeassistant.local:52932`; and
- a proxied request to `https://media.example.test/...` produces media URLs
  under `https://media.example.test` even when the container receives plain
  HTTP from the proxy.

## Constraints

The Stremio SDK parses an HTTP request and invokes its stream handler with only
the resource fields and decoded add-on configuration. It does not pass the
Express request to `addon.ts`, `getTopItems()`, or `getServerUrl()`. Changing
every function to accept a request is therefore insufficient without replacing
or duplicating the SDK's HTTP router.

The origin is request-specific. A process-global mutable value is unsafe
because simultaneous requests may arrive through different hostnames. The
container's listening address, operating-system hostname, and internal port do
not describe the public address after Home Assistant port mapping or reverse
proxying.

## Architecture

Add a small server-origin module backed by Node.js `AsyncLocalStorage`. The
module has three responsibilities:

1. derive and validate an origin from an incoming request;
2. run request handling inside an asynchronous context containing that origin;
3. return the origin to `getServerUrl()` for the current request.

`server.ts` already wraps the HTTP server's original request listener so that
it can dispatch custom routes. It will derive the origin at the start of that
wrapper and invoke both custom routes and the original Stremio SDK listeners
inside the request context. Node propagates the context through the promises
used by the SDK and stream handler, while keeping concurrent requests isolated.

The existing `getTopItems()` API remains unchanged. `getServerUrl()` replaces
its hard-coded value with the origin stored for the active request. It returns
the normalized origin without a trailing slash, preserving the current media
URL construction.

## Origin derivation and proxy trust

For a direct connection, the origin uses the request's `Host` header and the
connection protocol. The current server accepts plain HTTP, so a direct request
normally produces an `http` origin. The host value includes the external port
when the client supplied one.

Reverse-proxy headers are a trust boundary. A new optional `TRUST_PROXY`
environment variable contains a comma-separated list of trusted proxy IP
addresses, CIDR ranges, or the conventional `proxy-addr` names such as
`loopback`, `linklocal`, and `uniquelocal`. Whitespace around individual entries
is ignored, while an invalid entry fails server startup. When the immediate peer
matches this configuration, origin derivation prefers:

- `X-Forwarded-Proto` for the public scheme; and
- `X-Forwarded-Host` for the public host and port, falling back to `Host` when
  the proxy preserves the original host instead.

When `TRUST_PROXY` is absent, empty, or does not match the immediate peer,
forwarded headers are ignored. This keeps a direct client from opting itself
into proxy behavior. Proxy documentation will require the trusted edge proxy to
replace client-supplied forwarded host and protocol headers rather than append
untrusted values. Comma-separated forwarded host or protocol values are
rejected as ambiguous. `proxy-addr` will be a direct runtime dependency rather
than relying on Express's transitive installation.

The derived value is parsed as a URL and accepted only when:

- the protocol is `http:` or `https:`;
- a non-empty hostname is present;
- credentials are absent; and
- no path, query string, or fragment is present.

The stored value is the URL's normalized `origin`, which handles ports and
bracketed IPv6 hosts consistently.

## Error handling

A request with a missing or invalid effective host, an unsupported forwarded
protocol, or ambiguous forwarded values fails origin derivation with a clear,
non-secret error. The request wrapper logs the failure and returns an HTTP 400
response without invoking a stream resolver.

Calling `getServerUrl()` outside an active HTTP request context throws an
explicit error. It does not fall back to the obsolete hosted deployment or to a
container-local address, because either fallback would return a plausible but
unreachable stream URL.

The existing stream handler continues to catch resolver and construction
errors according to its current behavior. No origin data is retained after the
request finishes.

## Configuration and documentation

`.env.example` will document `TRUST_PROXY` without enabling it by default. The
Home Assistant schema will expose the same comma-separated value as an optional
`trusted_proxies` string and `homeAssistantConfig.ts` will map a non-empty value
to `TRUST_PROXY`. The setting has no default, so the add-on remains directly
usable without configuration and does not trust forwarded headers implicitly.
The add-on and package patch versions will advance together so Home Assistant
detects the configuration change.

Users who place CzStreams behind a reverse proxy configure the proxy address or
network and ensure it supplies sanitized `X-Forwarded-Proto` and, when needed,
`X-Forwarded-Host` headers. Local development and non-Home Assistant deployments
set the equivalent environment variable directly.

The Home Assistant user documentation will include a reverse-proxy example and
explain that the configured trust range should be no broader than the network
from which the proxy connects.

## Testing

Focused tests will verify:

- direct HTTP origins, including non-default ports and bracketed IPv6 hosts;
- trusted proxy selection of the forwarded HTTPS scheme and public host;
- fallback from `X-Forwarded-Host` to a proxy-preserved `Host` header;
- ignored spoofed forwarding headers from an untrusted peer;
- startup rejection of an invalid trusted-proxy expression;
- rejection of missing, malformed, ambiguous, credential-bearing, and
  unsupported origins;
- an explicit failure when `getServerUrl()` runs without request context;
- propagation through asynchronous work; and
- isolation of overlapping asynchronous requests using different hostnames.

Home Assistant configuration tests will verify the optional schema field and
its exact non-empty mapping to `TRUST_PROXY`, including absent and empty values.

Existing tests, TypeScript checks, and lint checks remain part of verification.
A server-level test will confirm that a stream response's `/media/...` URL uses
the effective request origin rather than the removed hosted hostname.

## Scope boundaries

This change does not introduce a canonical `PUBLIC_BASE_URL`, modify resolver
behavior, eagerly resolve media, enable Home Assistant ingress, trust forwarded
headers by default, or replace the Stremio SDK router. It only changes how the
callback URL for the existing `/media/...` endpoint obtains its origin.
