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
