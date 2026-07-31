import { readFileSync } from "fs";
import type { ContentType, Manifest } from "stremio-addon-sdk";
import SDK from "stremio-addon-sdk";

import { getTopItems } from "./src/getTopItems.ts";
import { getMeta } from "./src/meta.ts";
import { getTmdbDetails } from "./src/service/tmdb.ts";
import {
  type ConfigField,
  type UserConfigData,
} from "./src/userConfig/userConfig.ts";
import { bytesToSize } from "./src/utils/convert.ts";
import { getAllResolvers } from "./src/utils/resolvers.ts";

function getManifest() {
  const pkgData = readFileSync("./package.json", "utf8");
  const pkg = JSON.parse(pkgData);
  const allResolvers = getAllResolvers();
  const userConfigDef = allResolvers.reduce(
    (defs, resolver) => [...defs, ...resolver.getConfigFields()],
    [] as ConfigField[],
  );

  return {
    id: "community.czstreams",
    version: pkg.version,
    catalogs: [],
    resources: ["stream"],
    types: ["movie", "series"],
    name: "CzStreams",
    description: "",
    idPrefixes: ["tt"],
    logo: "https://play-lh.googleusercontent.com/qDMsLq4DWg_OHEX6YZvM1FRKnSmUhzYH-rYbWi4QBosX9xTDpO8hRUC-oPtNt6hoFX0=w256-h256-rw",
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
    config: userConfigDef,
  } satisfies Manifest;
}

const builder = new SDK.addonBuilder(getManifest());

builder.defineStreamHandler(async (props) => {
  const { type, id, config } = props as {
    type: ContentType;
    id: string;
    config: UserConfigData;
  };
  try {
    const [baseMeta, tmdbMeta] = await Promise.all([
      getMeta(type, id),
      getTmdbDetails(id, "cs"),
    ]);

    const meta = {
      ...baseMeta,
      names: {
        en: baseMeta.name,
        ...tmdbMeta?.names,
      },
    };

    const allResolvers = getAllResolvers();

    const topItems = await getTopItems(meta, allResolvers, config);

    const streams = topItems.map((item) => ({
      url: item.video,
      name: `${item.resolverName}, (${bytesToSize(item.size)})`,
      description: item.title,
      subtitles: item.subtitles ?? undefined,
      behaviorHints: {
        videoSize: item.size,
        bingeGroup: `${item.resolverName}-${item.resolverId}`,
        ...(item.behaviorHints ?? {}),
        filename: item.title,
      },
    }));
    return {
      streams,
    };
  } catch (e) {
    console.error(e);
    // otherwise return no streams
    return { streams: [] };
  }
});

export const addonInterface = builder.getInterface();
