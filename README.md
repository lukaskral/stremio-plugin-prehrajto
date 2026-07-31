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
