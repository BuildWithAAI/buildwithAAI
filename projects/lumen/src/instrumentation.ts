export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VITEST) return;
  const { startLoop } = await import("./server/engine");
  startLoop();
}
