export async function onRequestError(error: unknown, _request: unknown, context: { routePath?: string }): Promise<void> {
  const name = error instanceof Error ? error.name : "Error";
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "unhandled", status: 500, route: context?.routePath ?? "request", name }));
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VITEST) return;
  const { startLoop } = await import("./server/engine");
  startLoop();
}
