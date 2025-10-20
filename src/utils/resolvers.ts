import type { Resolver } from "../getTopItems.ts";
import { initResolvers } from "../initResolvers.ts";
import type { UserConfigData } from "../userConfig/userConfig.ts";

export let allResolvers: Resolver[] = [];
export function getAllResolvers() {
  if (!allResolvers.length) {
    allResolvers = initResolvers().filter((r) => r !== null);
  }
  return allResolvers;
}

/**
 *
 * @param {Resolver[]} allResolvers
 * @param {UserConfigData} config
 * @returns {Promise<Resolver[]>}
 */
export async function getActiveResolvers(
  allResolvers: Resolver[],
  config: UserConfigData,
): Promise<Resolver[]> {
  const resolvers = (
    await Promise.all(
      allResolvers.map(async (r) => ({
        resolver: r,
        valid: await r.validateConfig(config),
      })),
    )
  )
    .filter((obj) => obj.valid)
    .map((obj) => obj.resolver);
  return resolvers;
}
