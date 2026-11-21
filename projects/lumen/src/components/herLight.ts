import * as THREE from "three";
import { LIGHT, lightGlsl } from "../forge/light";

/**
 * How the live world lights what she has built.
 *
 * The sums are her own viewport's, generated from src/forge/light.ts, so a building reads the same
 * here as in the picture she draws of it.
 */

type Surface = { name: string; color: string; emissive: number; alpha: number };

/** A colour in display values, as the engine writes it. The shader works in these and converts at the end. */
function tone(color: string | number): THREE.Vector3 {
  const value = typeof color === "number" ? color : Number.parseInt(color.slice(1, 7), 16);
  return new THREE.Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/**
 * Where distance starts to fade things into the sky's colour, and where it has taken them almost whole.
 * The world's own fog uses the same two numbers in the open view, so her builds and the ground fade together.
 */
export const HAZE_NEAR = 320;
export const HAZE_FAR = 1450;

/**
 * One set of values shared by everything she has built, so the sky changes them all at once.
 * They start as plain black, white and grey, and take her colours from the world's first reading.
 */
const shared = {
  uKey: { value: new THREE.Vector3(...LIGHT.key).normalize() },
  uSun: { value: 1 },
  uSky: { value: 1 },
  uDeep: { value: new THREE.Vector3(0, 0, 0) },
  uPale: { value: new THREE.Vector3(1, 1, 1) },
  uHaze: { value: new THREE.Vector3(0.7, 0.7, 0.7) },
  uHazeNear: { value: HAZE_NEAR },
  uHazeFar: { value: HAZE_FAR },
};

export function setHerLight(next: { key?: THREE.Vector3; sun?: number; sky?: number; haze?: number; deep?: string; pale?: string }): void {
  if (next.key && next.key.lengthSq() > 0) shared.uKey.value.copy(next.key).normalize();
  if (next.sun !== undefined) shared.uSun.value = Math.max(0, Math.min(1, next.sun));
  if (next.sky !== undefined) shared.uSky.value = Math.max(0, Math.min(1, next.sky));
  if (next.haze !== undefined) shared.uHaze.value.copy(tone(next.haze));
  if (next.deep) shared.uDeep.value.copy(tone(next.deep));
  if (next.pale) shared.uPale.value.copy(tone(next.pale));
}

const VERTEX = `
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = mat3(modelMatrix) * normal;
  vec4 mv = viewMatrix * world;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
uniform vec3 uBase;
uniform float uEmissive;
uniform float uAlpha;
uniform vec3 uAccent;
uniform vec3 uKey;
uniform float uSun;
uniform float uSky;
uniform vec3 uDeep;
uniform vec3 uPale;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vDepth;
${lightGlsl()}
vec3 toLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
}
void main() {
  vec3 c = herLit(uBase, uEmissive, normalize(vNormalW), normalize(cameraPosition - vWorld), uKey, uDeep, uPale, uAccent, uSun, uSky);
  float haze = clamp((vDepth - uHazeNear) / (uHazeFar - uHazeNear), 0.0, 0.92);
  c = mix(c, uHaze, haze);
  gl_FragColor = vec4(toLinear(c), uAlpha);
  #include <colorspace_fragment>
}
`;

const kept = new Map<string, THREE.ShaderMaterial[]>();

/**
 * The eight materials of one look. Every build that wears the look shares them, so they are marked
 * and must not be disposed with a build.
 */
export function forgeMaterials(look: Surface[]): THREE.ShaderMaterial[] {
  const key = look.map((item) => `${item.color}/${item.emissive}/${item.alpha}`).join("|");
  let made = kept.get(key);
  if (!made) {
    const glow = look.find((item) => item.name === "glow");
    const accent = glow ? tone(glow.color) : new THREE.Vector3(1, 1, 1);
    made = look.map((item) => {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...shared, uBase: { value: tone(item.color) }, uEmissive: { value: item.emissive }, uAlpha: { value: item.alpha }, uAccent: { value: accent } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: item.alpha < 1,
        depthWrite: item.alpha >= 1,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      material.userData.shared = true;
      return material;
    });
    kept.set(key, made);
  }
  return made;
}
