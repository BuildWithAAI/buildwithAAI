/**
 * Her light, written down once.
 *
 * Her own viewport (view.ts) draws a build with these numbers, and the live world's shader is
 * generated from the same numbers, so a building reads the same in a picture and in the world.
 * Surfaces are lit from one side, filled from the sky above and the water below, and brighten
 * where they turn away from the eye, the way her own body does.
 */
export const LIGHT = {
  /** Where the light comes from when there is no sun to ask. */
  key: [0.5, 0.72, 0.4] as const,
  /** How strongly the lit side is lit. */
  direct: 0.82,
  /** Light from the sky above and the water below: a level, and how much more a face turned upward gets. */
  fill: 0.3,
  fillUp: 0.2,
  /** The least light anything gets, and how much of the fill is added to it. */
  floor: 0.16,
  fillGain: 0.42,
  /** How much of her gold the lit side takes. */
  warm: 0.3,
  /** How much an edge turning away from the eye brightens, and how tightly. */
  rim: 0.42,
  rimPower: 3,
  /** How far a shining surface is pulled back to its own colour. */
  shine: 0.85,
  /** A full light is lifted toward white by this much. */
  glare: 0.25,
} as const;

/** A colour in display values, each from 0 to 1. */
export type Tone = [number, number, number];
export type Tones = { deep: Tone; pale: Tone; accent: Tone };

const mix = (a: Tone, b: Tone, t: number): Tone => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The colour of one point of a surface. The normal must already face the eye.
 * `sun` and `sky` are 1 in full day; the live world lowers them at dusk and at night.
 */
export function lit(base: Tone, emissive: number, up: number, towardKey: number, towardEye: number, tones: Tones, sun = 1, sky = 1): Tone {
  const direct = Math.max(0, towardKey) * sun;
  const fill = LIGHT.fill + LIGHT.fillUp * up;
  const edge = (1 - Math.max(0, towardEye)) ** LIGHT.rimPower;
  const shade = (LIGHT.floor + fill * LIGHT.fillGain) * sky;
  const warm = mix([1, 1, 1], tones.accent, LIGHT.warm);
  let c: Tone = [base[0] * (shade + direct * LIGHT.direct * warm[0]), base[1] * (shade + direct * LIGHT.direct * warm[1]), base[2] * (shade + direct * LIGHT.direct * warm[2])];
  c = mix(mix(tones.deep, c, 0.5 + 0.5 * Math.min(1, shade + direct)), tones.pale, edge * LIGHT.rim * sky);
  c = mix(c, base, emissive * LIGHT.shine);
  if (emissive >= 1) c = mix(base, [1, 1, 1], LIGHT.glare);
  return c;
}

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

/** The same sums as `lit`, as shader source. It is built from LIGHT, so the two cannot drift apart. */
export function lightGlsl(): string {
  return `
vec3 herLit(vec3 base, float emissive, vec3 n, vec3 toEye, vec3 key, vec3 deep, vec3 pale, vec3 accent, float sun, float sky) {
  if (dot(n, toEye) < 0.0) n = -n;
  float direct = max(0.0, dot(n, key)) * sun;
  float fill = ${f(LIGHT.fill)} + ${f(LIGHT.fillUp)} * n.y;
  float edge = pow(1.0 - max(0.0, dot(n, toEye)), ${f(LIGHT.rimPower)});
  float shade = (${f(LIGHT.floor)} + fill * ${f(LIGHT.fillGain)}) * sky;
  vec3 warm = mix(vec3(1.0), accent, ${f(LIGHT.warm)});
  vec3 c = base * (shade + direct * ${f(LIGHT.direct)} * warm);
  c = mix(mix(deep, c, 0.5 + 0.5 * min(1.0, shade + direct)), pale, edge * ${f(LIGHT.rim)} * sky);
  c = mix(c, base, emissive * ${f(LIGHT.shine)});
  if (emissive >= 1.0) c = mix(base, vec3(1.0), ${f(LIGHT.glare)});
  return c;
}
`;
}
