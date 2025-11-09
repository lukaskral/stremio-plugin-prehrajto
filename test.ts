import { getResolver } from "./src/service/sosac.ts";

(async function test() {
  const addonConfig = {};
  const resolver = getResolver();
  await resolver.init();
  const results = await resolver.search(
    "harry potter a kámen mudrců",
    addonConfig,
  );
  console.log(
    `/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(results[0].resolverId)}`,
  );

  console.log("Results", results.length);
  if (results.length > 0) {
    const first = await resolver.resolve(results[0].resolverId, addonConfig);
    console.log(first);
  }
})();
