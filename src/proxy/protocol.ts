export type HeaderPair = [name: string, value: string];

export type ProxyRequestEnvelope = {
  url: string;
  method: string;
  headers: HeaderPair[];
  bodyBase64?: string;
};

export type ProxyResponseEnvelope = {
  status: number;
  statusText: string;
  headers: HeaderPair[];
  url: string;
  bodyBase64: string;
  requestId: string;
};

export type ProxyErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export function encodeBody(body: ArrayBuffer | Uint8Array): string {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  return Buffer.from(bytes).toString("base64");
}

export function decodeBody(bodyBase64 = ""): Uint8Array {
  return new Uint8Array(Buffer.from(bodyBase64, "base64"));
}

export function headersToPairs(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => {
    if (name !== "set-cookie") {
      pairs.push([name, value]);
    }
  });
  for (const cookie of headers.getSetCookie()) {
    pairs.push(["set-cookie", cookie]);
  }
  return pairs;
}

export function headersFromPairs(pairs: HeaderPair[]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) {
    headers.append(name, value);
  }
  return headers;
}

function isHeaderPairs(value: unknown): value is HeaderPair[] {
  return (
    Array.isArray(value) &&
    value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === "string" &&
        typeof pair[1] === "string",
    )
  );
}

export function isProxyRequestEnvelope(
  value: unknown,
): value is ProxyRequestEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ProxyRequestEnvelope>;
  return (
    typeof item.url === "string" &&
    typeof item.method === "string" &&
    isHeaderPairs(item.headers) &&
    (item.bodyBase64 === undefined || typeof item.bodyBase64 === "string")
  );
}

export function isProxyResponseEnvelope(
  value: unknown,
): value is ProxyResponseEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ProxyResponseEnvelope>;
  return (
    typeof item.status === "number" &&
    typeof item.statusText === "string" &&
    isHeaderPairs(item.headers) &&
    typeof item.url === "string" &&
    typeof item.bodyBase64 === "string" &&
    typeof item.requestId === "string"
  );
}

export function isProxyErrorEnvelope(value: unknown): value is ProxyErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = (value as ProxyErrorEnvelope).error;
  return (
    typeof error?.code === "string" &&
    typeof error.message === "string" &&
    typeof error.requestId === "string"
  );
}
