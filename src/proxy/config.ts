export type Environment = Record<string, string | undefined>;

export type ProxyClientConfig = {
  url: URL;
  token: string;
};

export type ProxyServerConfig = {
  token: string;
  allowedHosts: Set<string>;
  debug: boolean;
};

export const DEFAULT_ALLOWED_HOSTS = ["prehraj.to"];
export const MAX_PROXY_ENVELOPE_BYTES = 512 * 1024;
export const MAX_PROXY_REQUEST_BYTES = 256 * 1024;
export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;
export const PROXY_TIMEOUT_MS = 15_000;
export const MAX_PROXY_REDIRECTS = 5;
export const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST"]);

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be configured`);
  }
  return normalized;
}

export function getProxyClientConfig(
  env: Environment = process.env,
): ProxyClientConfig | null {
  const rawUrl = env.SERVICE_PROXY_URL?.trim();
  const rawToken = env.SERVICE_PROXY_CLIENT_TOKEN?.trim();

  if (!rawUrl && !rawToken) {
    return null;
  }
  if (!rawUrl) {
    throw new Error(
      "SERVICE_PROXY_URL must be configured with SERVICE_PROXY_CLIENT_TOKEN",
    );
  }
  if (!rawToken) {
    throw new Error(
      "SERVICE_PROXY_CLIENT_TOKEN must be configured with SERVICE_PROXY_URL",
    );
  }

  const url = new URL(rawUrl);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("SERVICE_PROXY_URL must use HTTPS except for local tests");
  }

  return { url, token: rawToken };
}

export function getProxyServerConfig(
  env: Environment = process.env,
): ProxyServerConfig {
  const token = requiredValue(
    env.SERVICE_PROXY_TOKEN,
    "SERVICE_PROXY_TOKEN",
  );
  const allowedHosts = (
    env.SERVICE_PROXY_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(",")
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  if (allowedHosts.length === 0) {
    throw new Error(
      "SERVICE_PROXY_ALLOWED_HOSTS must contain at least one hostname",
    );
  }

  return {
    token,
    allowedHosts: new Set(allowedHosts),
    debug: env.SERVICE_PROXY_DEBUG?.toLowerCase() === "true",
  };
}
