export type Cookie = { name: string; value: string };

/**
 * Extract cookies from response
 */
export function extractCookies(result: Response): ReadonlyArray<Cookie> {
  const cookies = result.headers
    .getSetCookie()
    .map((cookie) => {
      const parts = cookie.split(";");
      const [name, value] = parts[0].split("=");
      return { name, value };
    })
    .filter((cookie) => cookie.value.toLowerCase() !== "deleted");

  return cookies;
}

export function headerCookies(cookies: ReadonlyArray<Cookie>) {
  return {
    cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
  };
}
