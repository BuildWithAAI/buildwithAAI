export type ScreenPoint = { x: number; y: number };

/** Narrow screens keep the name. The activity line is what runs off the edge. */
export function labelCaption(name: string, activity: string, feeling: string, narrow: boolean): string {
  if (narrow) return name.slice(0, 24);
  return `${name}\n${activity}\n${feeling}`.slice(0, 180);
}

export function shortSkyLine(clock: string, phase: string): string {
  const moon = phase.includes(" ") ? phase : `${phase} moon`;
  return `${clock} · ${moon}`;
}

/** Pull a label inside the screen and nudge it off anything it sits on. */
export function clampLabelPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  placed: ScreenPoint[],
  obstacle?: ScreenPoint,
  margin = 72,
): ScreenPoint {
  const halfW = Math.min(Math.max(28, margin), Math.max(28, width / 2 - 8));
  const top = 68;
  const bottom = Math.max(top + 8, height - 128);
  let nx = Math.min(width - halfW, Math.max(halfW, x));
  let ny = Math.min(bottom, Math.max(top, y));
  if (obstacle && Number.isFinite(obstacle.x) && Math.abs(nx - obstacle.x) < 130 && Math.abs(ny - obstacle.y) < 80) {
    ny = Math.max(top, obstacle.y - 84);
  }
  for (const other of placed) {
    if (Math.abs(nx - other.x) < 140 && Math.abs(ny - other.y) < 42) {
      const lifted = other.y - 46;
      if (lifted >= top) ny = lifted;
      else nx = Math.min(width - halfW, other.x + 148);
    }
  }
  nx = Math.min(width - halfW, Math.max(halfW, nx));
  ny = Math.min(bottom, Math.max(top, ny));
  return { x: nx, y: ny };
}

/** One clean line of the thought, with an ellipsis, until it is opened. */
export function clipThought(text: string, open: boolean, limit = 72): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (open || clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  const base = (space > 24 ? cut.slice(0, space) : cut).trimEnd();
  return `${base}…`;
}

/** Sit the thought just above Zoora's head, clear of her name. */
export function placeThought(head: ScreenPoint, label: ScreenPoint | undefined, width: number, height: number): ScreenPoint {
  const half = Math.min(96, Math.max(40, width / 2 - 8));
  const x = Math.min(width - half, Math.max(half, head.x));
  const minTop = 210;
  let y = head.y - 78;
  if (label && Math.abs(x - label.x) < 130 && y > label.y - 84) y = label.y - 92;
  if (y < minTop) y = Math.max(minTop, (label?.y ?? head.y) + 110);
  return {
    x,
    y: Math.min(height - 150, Math.max(minTop, y)),
  };
}
