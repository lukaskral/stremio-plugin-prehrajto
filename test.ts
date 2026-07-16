import { getResolver } from "./src/service/prehrajto.ts";

function isDnsUnavailable(error: unknown): boolean {
  if (!(error instanceof Error) || !("cause" in error)) {
    return false;
  }

  const cause = error.cause;
  return (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "ENOTFOUND"
  );
}

async function test() {
  const addonConfig = {};
  const resolver = getResolver();
  await resolver.init();
  const results = await resolver.search(
    "harry potter a kámen mudrců",
    addonConfig,
  );
  console.log(
    `/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(results[0].resolverId)}`,
  );

  console.log("Results", results.length);
  if (results.length === 0) {
    console.error("No results found");
    return;
  }

  const first = await resolver.resolve(results[0].resolverId, addonConfig);
  const videoUrl = first.video;
  console.log("Video URL", videoUrl);

  const response = await fetch(videoUrl, {
    headers: {
      Range: "bytes=0-1023",
    },
  });

  if (response.status >= 400) {
    console.error("Response", response.status);
    console.error("Response", response.headers);
    return;
  }

  console.log("OK", response.status);
}

test().catch((error: unknown) => {
  if (isDnsUnavailable(error)) {
    console.warn("Skipping integration test because prehraj.to DNS is unavailable");
    return;
  }

  throw error;
});
