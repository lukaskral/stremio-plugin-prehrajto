export type ConfigField = {
  key: string;
  type: "text" | "password";
  title: string;
};

export type UserConfigData = Record<string, string>;
