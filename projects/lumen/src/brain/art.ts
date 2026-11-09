const TITLES = [
  "Ring of the second tide",
  "Studio wall, dimmed",
  "A school that didn't stay",
  "Pocket light",
  "Salt geometry",
  "The arch, once",
  "Unfinished buoy",
  "Pale seam",
];

export function artTitle(seed: number): string {
  return TITLES[Math.abs(seed) % TITLES.length] ?? "Tide ring";
}

export function makeSvg(seed: number, color: string): string {
  const a = 30 + (seed % 40);
  const b = 18 + ((seed >> 3) % 30);
  const c = (seed % 360);
  const safe = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8ef0d8";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" role="img">
  <rect width="240" height="280" fill="#07161c"/>
  <g fill="none" stroke="${safe}" stroke-width="2">
    <ellipse cx="120" cy="90" rx="${a + 20}" ry="${b + 10}" opacity="0.9"/>
    <ellipse cx="120" cy="96" rx="${a}" ry="${b}" opacity="0.55"/>
    <path d="M${90 - (seed % 10)} 120 C 80 ${160 + (seed % 20)}, 100 200, 92 250" />
    <path d="M120 124 C 120 170, ${130 + (seed % 15)} 190, 124 255" />
    <path d="M150 120 C 168 168, 150 210, 160 248" />
    <circle cx="${70 + (seed % 50)}" cy="${60 + (c % 40)}" r="3" fill="${safe}" stroke="none"/>
    <circle cx="${150 - (seed % 30)}" cy="${200 - (c % 25)}" r="2" fill="${safe}" stroke="none"/>
  </g>
</svg>`;
}
