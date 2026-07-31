import { readFile } from "node:fs/promises";

export type HomeAssistantOptions = Record<string, unknown>;
export type HomeAssistantEnvironment = Record<string, string>;
export type ReadOptionsFile = (
  path: string,
  encoding: "utf8",
) => Promise<string>;

export function parseHomeAssistantOptions(json: string): HomeAssistantOptions {
  const options: unknown = JSON.parse(json);
  if (options === null || Array.isArray(options) || typeof options !== "object") {
    throw new Error("Home Assistant options must be a JSON object");
  }
  return options as HomeAssistantOptions;
}

export async function loadHomeAssistantOptions(
  path = "/data/options.json",
  readOptionsFile: ReadOptionsFile = async (optionsPath, encoding) =>
    readFile(optionsPath, encoding),
): Promise<HomeAssistantOptions> {
  try {
    return parseHomeAssistantOptions(await readOptionsFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function getHomeAssistantEnvironment(
  options: HomeAssistantOptions,
): HomeAssistantEnvironment {
  const environment: HomeAssistantEnvironment = {};
  const username = options.prehrajto_debug_username;
  const password = options.prehrajto_debug_password;

  if (typeof username === "string" && username.length > 0) {
    environment.PREHRAJTO_DEBUG_USERNAME = username;
  }
  if (typeof password === "string" && password.length > 0) {
    environment.PREHRAJTO_DEBUG_PASSWORD = password;
  }

  return environment;
}
