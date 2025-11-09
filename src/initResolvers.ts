// import { getResolver as getFastshareResolver } from "./service/fastshare.ts";
// import { getResolver as getHellspyResolver } from "./service/hellspy.ts";
import { getResolver as getPrehrajtoResolver } from "./service/prehrajto.ts";
// import { getResolver as getSledujtetoResolver } from "./service/sledujteto.ts";
// import { getResolver as getWebshareResolver } from "./service/webshare.ts";

/** @typedef {import('./getTopItems.js').Resolver} Resolver */

export function initResolvers() {
  /** @type {Resolver[]} */
  const resolvers = [
    // getFastshareResolver(),
    // getHellspyResolver(),
    getPrehrajtoResolver(),
    // getSledujtetoResolver(),
    // getWebshareResolver(),
  ];

  const activeResolvers = resolvers
    .map((resolver) => ({
      resolver,
      initialized: resolver.init(),
    }))
    .map((r) => (r.initialized ? r.resolver : null))
    .filter((r) => Boolean(r));
  return activeResolvers;
}
