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
by Stremio.

## Optional test endpoint credentials

The add-on configuration includes optional **PrehrajTo debug username** and
**PrehrajTo debug password** fields. They are used only by the `/test` endpoint;
normal Stremio resolver credentials are still configured through CzStreams in
Stremio.

If either field is empty, CzStreams starts normally and `/test` returns a `503`
response explaining that both debug environment variables are required.

## Reverse proxy

Media URLs must retain the public scheme and hostname used by Stremio. When a
reverse proxy terminates HTTPS, set the optional `trusted_proxies` add-on field
to the proxy's source IP address or CIDR range. Do not enter the addresses of
Stremio clients.

Configure the proxy to replace incoming forwarding headers and send the public
values to CzStreams. For nginx, the relevant directives are:

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

Forwarded headers are ignored when `trusted_proxies` is empty or the connection
does not come from a matching proxy address. Restart the add-on after changing
the setting.

## Troubleshooting

- Confirm the add-on is running and inspect its log for startup errors.
- Confirm the selected host port is not already used by another service.
- Test the manifest URL from the same device or network as Stremio.
- Use the mapped host port in the URL, not necessarily the internal port
  `52932`.
- Home Assistant ingress is intentionally unavailable because Stremio needs a
  directly reachable manifest URL.
