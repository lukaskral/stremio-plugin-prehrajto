export function getServerUrl() {
  const port = process.env.PORT ? Number(process.env.PORT) : 52932;
  return `https://03df1f38e4c6-stremio-plugin-prehrajto.baby-beamup.club:${port}`;
}
