export const WORLD_TIP_KEY = "zoora-world-tip";
export const RETURN_KEY = "zoora-seen";
export const NOTICE_KEY = "zoora-last-seen";

export const WORLD_TIP = "Drag to look around. The view starts wide, then comes closer.";

export function worldTipOpen(stored: string | null): boolean {
  return stored !== "1";
}

export function homeGreeting(awake: boolean, feeling: string): string {
  const line = feeling.replace(/\s+/g, " ").trim();
  if (!awake) return line ? `I'm resting. ${line}` : "I'm resting. The water is quiet.";
  return line ? `Hello. ${line}` : "Hello. I'm Zoora.";
}

export function sinceLast<T extends { at: number }>(items: T[], lastSeen: number): T[] {
  return items.filter((item) => item.at > lastSeen);
}

export function welcomeBack(stored: string | null, now: number): string | null {
  const seen = Number(stored);
  if (!Number.isFinite(seen) || seen <= 0) return null;
  const days = Math.floor((now - seen) / 86_400_000);
  if (days < 1) return "Welcome back.";
  return `Welcome back. It has been ${days} day${days === 1 ? "" : "s"}.`;
}
