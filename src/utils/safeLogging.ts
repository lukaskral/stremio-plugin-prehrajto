export function logRequestHandlerFailure(...details: unknown[]) {
  void details;
  console.error("Request handler failed");
}
