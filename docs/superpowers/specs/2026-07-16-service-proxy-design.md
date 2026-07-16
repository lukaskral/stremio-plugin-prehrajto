# Service Proxy Design

## Purpose

Add an optional, project-specific HTTP relay that lets a local addon instance execute PrehrajTo control-plane requests from the deployed addon's network. This is a debugging tool for reproducing deployment-only behavior. It does not proxy video or subtitle payloads and must not become a general-purpose forward proxy.

## Scope

The relay covers the PrehrajTo requests used to:

- establish an anonymous session;
- submit the authenticated login form;
- fetch search-result pages; and
- fetch media detail pages.

The relay does not rewrite or proxy the final media URL. Stremio continues to download media directly from the URL returned by the resolver. Metadata requests to unrelated services also remain direct.

## Architecture

Introduce a reusable `serviceFetch()` transport for storage-service HTTP requests. Its public contract matches the subset of the standard `fetch` API used by the resolvers and returns a normal `Response`.

In direct mode, which remains the default, `serviceFetch()` delegates to global `fetch`. In proxy mode it serializes a normalized request into a JSON envelope and sends it to a protected `/internal/service-proxy` endpoint on the deployed addon. The endpoint validates the request, performs the outbound fetch, and returns a JSON response envelope. The local transport reconstructs a standard `Response`, keeping resolver behavior such as cookie extraction and HTML parsing independent of the selected transport.

The relay endpoint is hosted by the existing addon server. It is not a separate process and does not support the HTTP `CONNECT` method.

## Configuration

Proxy use is opt-in. A local instance enables it with:

```dotenv
SERVICE_PROXY_URL=https://deployed-addon.example/internal/service-proxy
SERVICE_PROXY_TOKEN=a-long-random-shared-secret
```

The deployed server uses:

```dotenv
SERVICE_PROXY_TOKEN=a-long-random-shared-secret
SERVICE_PROXY_ALLOWED_HOSTS=prehraj.to
SERVICE_PROXY_DEBUG=false
```

`SERVICE_PROXY_URL` and `SERVICE_PROXY_TOKEN` must either both be present on a proxy client or both be absent. Partial configuration is an error. The relay endpoint remains unavailable when its token is unset. `SERVICE_PROXY_ALLOWED_HOSTS` is a comma-separated exact-hostname allowlist and defaults to `prehraj.to`.

The existing debug endpoint must not contain credentials in source code. Optional PrehrajTo debug credentials come from environment variables and the endpoint reports a configuration error when they are absent.

## Relay protocol

The client sends a `POST` request to `/internal/service-proxy` with the shared secret in an `Authorization: Bearer` header and a JSON body containing:

- the target URL;
- the target HTTP method;
- the target headers as ordered name/value pairs; and
- an optional base64-encoded request body.

Normalizing a `Request` before serialization preserves generated multipart boundaries for the login form. Ordered header pairs allow response reconstruction without assuming every header is unique, which is important for cookies.

The relay response contains:

- the upstream status and status text;
- upstream response headers as ordered name/value pairs;
- the final validated URL; and
- the response body encoded as base64.

The protocol is deliberately buffered because the supported login and HTML responses are small. Request and response size limits prevent it from being used for media transfer.

## Request validation and SSRF protection

Before making an outbound request, the relay:

1. authenticates the bearer token using a constant-time comparison;
2. accepts only `GET`, `HEAD`, and `POST` target methods;
3. requires an `https:` target URL;
4. rejects URLs containing embedded credentials;
5. requires an exact hostname match in `SERVICE_PROXY_ALLOWED_HOSTS`;
6. rejects request bodies over the configured fixed limit; and
7. strips hop-by-hop headers and never forwards the relay authorization header.

Outbound fetches use manual redirect handling. Each redirect target is resolved against the previous URL and passes the same protocol, credential, and hostname checks before it is followed. Redirects are capped at a small fixed count.

The relay applies a request timeout and aborts responses that exceed the fixed control-plane response limit. These constraints make the endpoint unsuitable for streaming media by design.

## Data flow

1. The PrehrajTo resolver calls `serviceFetch()` for login, search, or detail HTML.
2. If proxy configuration is absent, the request goes directly to PrehrajTo.
3. If proxy configuration is present, `serviceFetch()` creates a normalized `Request`, reads its small body, and posts the serialized envelope to the deployed relay.
4. The relay authenticates and validates the envelope and destination.
5. The relay performs the upstream request, validating every redirect.
6. The relay returns the buffered response envelope.
7. `serviceFetch()` reconstructs and returns a standard `Response`.
8. Existing cookie extraction and HTML parsing continue unchanged.
9. A resolved video URL is returned directly and is never passed through the relay.

## Errors and observability

Relay failures use a structured JSON error response with a stable code, a safe message, and a request ID. Codes distinguish authentication failure, malformed requests, forbidden destinations or methods, timeouts, size-limit failures, and upstream network failures.

The client raises a descriptive error that includes the relay request ID and safe message. It does not include credentials, cookies, authorization values, request bodies, or complete query strings.

For each request, the server logs the request ID, method, hostname, pathname, upstream status, duration, and byte counts. Query values and sensitive headers are excluded. `SERVICE_PROXY_DEBUG=true` enables additional sanitized lifecycle logging, not raw headers or bodies.

## Components

- A proxy configuration module parses and validates environment variables.
- A protocol module owns request/response envelope types and binary-safe serialization.
- `serviceFetch()` selects direct or proxy mode and reconstructs responses.
- A relay module authenticates, validates, executes, redirects, limits, and logs outbound requests.
- An Express endpoint adapts HTTP requests and responses to the relay module.
- The PrehrajTo resolver uses `serviceFetch()` only for its control-plane requests.
- The server registers the internal endpoint before falling back to Stremio SDK handlers.
- Documentation explains secure deployment and local debugging configuration.

Each component has a narrow interface so transport behavior, security validation, and resolver parsing can be tested independently.

## Testing

Automated tests cover:

- direct mode when proxy configuration is absent;
- rejection of partial proxy configuration;
- proxy request serialization and standard `Response` reconstruction;
- multipart request bodies and generated content-type boundaries;
- cookie and duplicate-header propagation;
- binary-safe request and response bodies;
- missing and incorrect tokens;
- protocol, credential, hostname, port, and method restrictions;
- redirect validation and redirect-count limits;
- request timeouts and request/response size ceilings;
- structured errors and log redaction; and
- an end-to-end login-style POST followed by cookie-bearing HTML requests through local fake relay and upstream servers.

Repository verification runs the TypeScript compiler, ESLint, and the automated test suite. Manual verification covers both direct local behavior and a local addon configured to use a deployed relay.

## Success criteria

- Existing deployments remain in direct mode unless explicitly configured.
- A local addon can execute PrehrajTo login, search, and detail requests from the deployed server's network.
- Resolver parsing and cookie behavior are identical in direct and proxy modes.
- Media downloads never traverse the relay.
- Unauthorized or non-allowlisted relay requests fail before any outbound connection.
- Logs provide enough sanitized context to compare local and deployed request outcomes.
- No credentials or shared secrets are committed to the repository or emitted in diagnostics.
