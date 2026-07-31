import { getServerOrigin } from "../serverOrigin.ts";

export function getServerUrl() {
  return getServerOrigin();
}
