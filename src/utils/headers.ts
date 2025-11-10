export const headers = {
  "accept-language": "en-GB,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=0, i",
  "sec-ch-ua": '"Chromium";v="142", "Brave";v="142", "Not_A Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "sec-gpc": "1",
  "upgrade-insecure-requests": "1",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

type Headers = Record<string, string>;

export type FetchOptions = {
  headers?: Headers;
};

export default headers;
