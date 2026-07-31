import {
  getHomeAssistantEnvironment,
  loadHomeAssistantOptions,
} from "./src/homeAssistantConfig.ts";

const options = await loadHomeAssistantOptions();
Object.assign(process.env, getHomeAssistantEnvironment(options));

await import("./server.ts");
