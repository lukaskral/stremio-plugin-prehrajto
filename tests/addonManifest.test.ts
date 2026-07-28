import { expect, it } from "vitest";

import { addonInterface } from "../addon.ts";

it("places proxy fields before resolver credentials in the manifest", () => {
  expect(addonInterface.manifest.config).toEqual([
    {
      key: "proxyUrl",
      type: "text",
      title: "HTTP egress proxy URL",
    },
    {
      key: "proxyApiKey",
      type: "password",
      title: "HTTP egress proxy API key",
    },
    {
      key: "prehrajtoUsername",
      type: "text",
      title: "PrehrajTo username",
    },
    {
      key: "prehrajtoPassword",
      type: "password",
      title: "PrehrajTo password",
    },
  ]);
});
