export type ConfigField = {
  key: string;
  type: "text" | "password";
  title: string;
};

export type UserConfigData = Record<string, string>;

export const PROXY_CONFIG_FIELDS = [
  {
    key: "proxyUrl",
    type: "text",
    title: "HTTP egress proxy URL",
  },
  {
    key: "proxyApiKey",
    type: "password",
    title: "HTTP egress proxy API key",
  },
] satisfies ConfigField[];
