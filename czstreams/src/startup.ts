type StartServer = () => Promise<void>;
type LogError = (message: string, error: unknown) => void;

export async function runWithStartupHandling(
  startServer: StartServer,
  logError: LogError = console.error,
): Promise<void> {
  try {
    await startServer();
  } catch (error) {
    logError("Failed to start server:", error);
    process.exitCode = 1;
  }
}
