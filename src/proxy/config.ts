import type { UserConfigData } from "../userConfig/userConfig.ts";
import {
  type ProxyEndpointPolicyDependencies,
  type ValidatedProxyEndpoint,
  validateProxyEndpoint,
} from "./targetPolicy.ts";

export type DirectTransportConfig = {
  mode: "direct";
};

export type ProxyTransportConfig = ValidatedProxyEndpoint & {
  mode: "proxy";
  apiKey: string;
};

export type TransportConfig = DirectTransportConfig | ProxyTransportConfig;

export type ProxyConfigValues = {
  proxyUrl?: string | null;
  proxyApiKey?: string | null;
};

export async function parseProxyConfig(
  values: ProxyConfigValues,
  dependencies?: ProxyEndpointPolicyDependencies,
): Promise<TransportConfig> {
  const proxyUrl = values.proxyUrl?.trim() ?? "";
  const proxyApiKey = values.proxyApiKey?.trim() ?? "";

  if (!proxyUrl && !proxyApiKey) {
    return { mode: "direct" };
  }
  if (!proxyUrl || !proxyApiKey) {
    throw new Error("Proxy URL and API key must be configured together");
  }

  const endpoint = await validateProxyEndpoint(proxyUrl, dependencies);
  return {
    mode: "proxy",
    ...endpoint,
    apiKey: proxyApiKey,
  };
}

export function parseUserProxyConfig(
  config: UserConfigData,
  dependencies?: ProxyEndpointPolicyDependencies,
): Promise<TransportConfig> {
  return parseProxyConfig(
    {
      proxyUrl: config.proxyUrl,
      proxyApiKey: config.proxyApiKey,
    },
    dependencies,
  );
}

export function parseProxyQueryConfig(
  searchParams: URLSearchParams,
  dependencies?: ProxyEndpointPolicyDependencies,
): Promise<TransportConfig> {
  return parseProxyConfig(
    {
      proxyUrl: searchParams.get("proxyUrl"),
      proxyApiKey: searchParams.get("proxyApiKey"),
    },
    dependencies,
  );
}
