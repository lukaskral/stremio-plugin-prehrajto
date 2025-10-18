import { getResolver } from "./src/service/prehrajto.ts";

(async function test() {
  const addonConfig = {
    prehrajtoUsername: "",
    prehrajtoPassword: "",
  };
  const resolver = getResolver();
  await resolver.init();
  const results = await resolver.search("elio", addonConfig);
  console.log("Results", results.length);
  if (results.length > 0) {
    const first = await resolver.resolve(results[0], addonConfig);
    console.log(first);
  }
})();
