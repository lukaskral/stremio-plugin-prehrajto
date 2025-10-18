export type ConfigField = {
  key: string;
  type: "text" | "password";
  title: string;
};

export const userConfigDef = [
  {
    key: "webshareUsername",
    type: "text" as const,
    title: "WebshareCz username",
  },
  {
    key: "websharePassword",
    type: "password" as const,
    title: "WebshareCz password",
  },
  {
    key: "prehrajtoUsername",
    type: "text" as const,
    title: "PrehrajTo username",
  },
  {
    key: "prehrajtoPassword",
    type: "password" as const,
    title: "PrehrajTo password",
  },
];

export type UserConfigData = Record<string, string>;
