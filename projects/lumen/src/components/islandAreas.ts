import * as THREE from "three";
import { areaById } from "../world/areas";

type Height = (x: number, z: number) => number;

/** Original meshes for the added areas. No imported models. */
export function addExpandedAreas(scene: THREE.Scene, low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { stall: THREE.Mesh; plants: THREE.Object3D[]; shells: THREE.Object3D; fireflies: THREE.Points; beam: THREE.Mesh; screen: THREE.Mesh; pin: THREE.Mesh; tape: THREE.Mesh; saloonSign: THREE.Mesh } {
  const beach = buildBeach(low, heightAt);
  const forest = buildForest(low, heightAt);
  const garden = buildGarden(low, heightAt, windows, lamps);
  const market = buildMarket(low, heightAt, windows);
  const light = buildLighthouse(low, heightAt, windows, lamps);
  const research = buildResearch(low, heightAt, windows, lamps);
  const saloon = buildSaloon(low, heightAt, windows, lamps);
  const floor = buildFloor(low, heightAt, windows, lamps);
  scene.add(beach.group, forest.group, garden.group, market.group, light.group, research.group, saloon.group, floor.group);
  return { stall: market.stall, plants: garden.plants, shells: beach.shells, fireflies: forest.fireflies, beam: light.beam, screen: research.screen, pin: research.pin, tape: floor.tape, saloonSign: saloon.sign };
}

function buildBeach(low: boolean, heightAt: Height): { group: THREE.Group; shells: THREE.Object3D } {
  const group = new THREE.Group();
  const x = 52;
  const z = -6;
  const y = heightAt(x, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0xc4a36a, roughness: 0.75 });
  for (let i = 0; i < 5; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 4.2), wood);
    plank.position.set(x + 1.2 + i * 1.15, y + 0.35, z + 3.2);
    plank.castShadow = !low;
    group.add(plank);
  }
  for (const postX of [x + 1.4, x + 5.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 6), wood);
    post.position.set(postX, y + 0.2, z + 4.6);
    group.add(post);
  }
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.7, low ? 8 : 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.55 }));
  hull.scale.set(1.4, 0.45, 0.7);
  hull.position.set(x + 3.2, y + 0.55, z + 3.2);
  group.add(hull);
  const shells = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xf4d7c4, roughness: 0.45 });
  for (const [sx, sz] of [[x - 2, z + 1], [x + 0.4, z - 1.2], [x - 1, z + 2]] as const) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI), shellMat);
    shell.scale.set(1.3, 0.45, 1);
    shell.position.set(sx, heightAt(sx, sz) + 0.08, sz);
    shells.add(shell);
  }
  shells.visible = false;
  group.add(shells);
  return { group, shells };
}

function buildForest(low: boolean, heightAt: Height): { group: THREE.Group; fireflies: THREE.Points } {
  const group = new THREE.Group();
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6d4a30, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x246b3e, roughness: 0.8 });
  const spots: [number, number][] = [[-52, 36], [-44, 44], [-40, 34], [-56, 46], [-36, 48], [-50, 30], [-42, 28]];
  const count = low ? 4 : spots.length;
  for (const [x, z] of spots.slice(0, count)) {
    const y = heightAt(x, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6), trunk);
    stem.position.set(x, y + 0.8, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 0), leaf);
    crown.position.set(x, y + 2.1, z);
    stem.castShadow = !low;
    group.add(stem, crown);
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.45), new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.7 }));
  bench.position.set(-46, heightAt(-46, 38) + 0.4, 38);
  group.add(bench);
  const flies = low ? 0 : 40;
  const positions = new Float32Array(Math.max(3, flies * 3));
  for (let i = 0; i < flies; i += 1) {
    positions[i * 3] = -48 + (i % 7) * 1.6;
    positions[i * 3 + 1] = 1.2 + (i % 3) * 0.4;
    positions[i * 3 + 2] = 36 + Math.floor(i / 7) * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd6ff9a, size: 0.12, transparent: true, opacity: 0.9 }));
  fireflies.visible = false;
  group.add(fireflies);
  return { group, fireflies };
}

function buildGarden(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { group: THREE.Group; plants: THREE.Object3D[] } {
  const group = new THREE.Group();
  const x = 22;
  const z = -36;
  const y = heightAt(x, z);
  const glass = new THREE.MeshStandardMaterial({ color: 0xd7fff4, transparent: true, opacity: 0.35, roughness: 0.05, emissive: 0xffe1b0, emissiveIntensity: 0.05 });
  windows.push(glass);
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f7f2, roughness: 0.4 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.2, 3.4), glass);
  house.position.set(x, y + 1.2, z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.1, 4), frame);
  roof.position.set(x, y + 2.6, z);
  roof.rotation.y = Math.PI / 4;
  group.add(house, roof);
  const plants: THREE.Object3D[] = [];
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3c9a55, roughness: 0.7 });
  for (const [dx, dz] of [[-1.2, 0.6], [0, 0.6], [1.2, 0.6], [-0.6, -0.5], [0.8, -0.5]] as const) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xc47b5a, roughness: 0.8 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 5), leaf);
    pot.position.set(x + dx, y + 0.16, z + dz);
    stem.position.set(x + dx, y + 0.55, z + dz);
    plants.push(stem);
    group.add(pot, stem);
  }
  if (!low) {
    const lamp = new THREE.PointLight(0xffe1b0, 0.05, 8);
    lamp.position.set(x, y + 1.8, z);
    lamps.push(lamp);
    group.add(lamp);
  }
  return { group, plants };
}

function buildMarket(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[]): { group: THREE.Group; stall: THREE.Mesh } {
  const group = new THREE.Group();
  const originX = -36;
  const originZ = -28;
  const colors = [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x8d99ae];
  let stall: THREE.Mesh | null = null;
  for (let i = 0; i < 4; i += 1) {
    const x = originX + i * 3.2;
    const y = heightAt(x, originZ);
    const cloth = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.6 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 4), cloth);
    roof.position.set(x, y + 1.7, originZ);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = !low;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4f3a }));
    post.position.set(x, y + 0.7, originZ);
    group.add(roof, post);
    if (i === 0) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ color: 0xf6e7d4 }));
      board.position.set(x, y + 0.9, originZ + 0.8);
      stall = board;
      group.add(board);
      const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffd7a1, emissiveIntensity: 0.08 });
      windows.push(glow);
    }
  }
  return { group, stall: stall! };
}

function buildLighthouse(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { group: THREE.Group; beam: THREE.Mesh } {
  const group = new THREE.Group();
  const x = 6;
  const z = 58;
  const y = heightAt(x, z);
  const stone = new THREE.MeshStandardMaterial({ color: 0xe7e1d6, roughness: 0.75 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xc4564a, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 4.2, low ? 8 : 16), stone);
  tower.position.set(x, y + 2.2, z);
  tower.castShadow = !low;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.45, low ? 8 : 16), stripe);
  band.position.set(x, y + 2.6, z);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffe08a, emissiveIntensity: 0.4, roughness: 0.2 });
  windows.push(lampMat);
  const room = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, low ? 8 : 16), lampMat);
  room.position.set(x, y + 4.5, z);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.6, low ? 8 : 16), stripe);
  cap.position.set(x, y + 5.05, z);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.35, 8, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  beam.rotation.z = Math.PI / 2;
  beam.position.set(x + 4, y + 4.5, z);
  beam.visible = false;
  group.add(tower, band, room, cap, beam);
  if (!low) {
    const light = new THREE.PointLight(0xffe08a, 0.2, 18);
    light.position.set(x, y + 4.5, z);
    lamps.push(light);
    group.add(light);
  }
  return { group, beam };
}

function buildResearch(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { group: THREE.Group; screen: THREE.Mesh; pin: THREE.Mesh } {
  const spot = areaById("research-station");
  const x = spot?.x ?? -16;
  const z = spot?.z ?? -44;
  const y = heightAt(x, z);
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd7d2c8, roughness: 0.8 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x8d5a3c, roughness: 0.7 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.3, 4.4), stone);
  wall.position.set(x, y + 1.15, z);
  wall.castShadow = !low;
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xb9d7e8, roughness: 0.15, transparent: true, opacity: 0.45 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, low ? 8 : 18, low ? 6 : 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.set(x, y + 2.3, z);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.8), timber);
  desk.position.set(x - 0.4, y + 0.72, z + 0.3);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.12), timber);
  leg.position.set(x - 0.4, y + 0.4, z + 0.55);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x16304a });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.45), screenMat);
  screen.position.set(x + 0.85, y + 1.45, z + 2.28);
  const cork = new THREE.MeshStandardMaterial({ color: 0xc6a15a, roughness: 0.85 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.35, 0.06), cork);
  board.position.set(x - 1.85, y + 1.45, z + 2.22);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xf4efe4 });
  const pin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.15), pinMat);
  pin.position.set(x - 1.85, y + 1.45, z + 2.3);
  group.add(wall, dome, desk, leg, screen, board, pin);
  if (!low) {
    const lamp = new THREE.PointLight(0xfff1c9, 0.15, 8);
    lamp.position.set(x, y + 2.2, z);
    lamps.push(lamp);
    group.add(lamp);
  }
  return { group, screen, pin };
}

function buildSaloon(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { group: THREE.Group; sign: THREE.Mesh } {
  const spot = areaById("solana-saloon");
  const x = spot?.x ?? 19;
  const z = spot?.z ?? 40;
  const y = heightAt(x, z);
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a4b2f, roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe7d3a1, roughness: 0.55 });
  const front = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 4.2), wood);
  front.position.set(x, y + 1.6, z);
  front.castShadow = !low;
  const falseFront = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.3, 0.18), trim);
  falseFront.position.set(x, y + 3.5, z + 2.1);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.12, 1.4), wood);
  porch.position.set(x, y + 0.2, z + 2.6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.8 });
  for (const dx of [-2.4, 2.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), postMat);
    post.position.set(x + dx, y + 1.2, z + 3.1);
    group.add(post);
  }
  const door = new THREE.MeshStandardMaterial({ color: 0x6b3a22, roughness: 0.7 });
  for (const dx of [-0.28, 0.28]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.3, 0.08), door);
    wing.position.set(x + dx, y + 0.8, z + 2.16);
    group.add(wing);
  }
  const signMat = new THREE.MeshBasicMaterial({ color: 0xf3e2b8 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), signMat);
  sign.position.set(x, y + 3.5, z + 2.22);
  group.add(front, falseFront, porch, sign);
  if (!low) {
    const lamp = new THREE.PointLight(0xffb15a, 0.2, 10);
    lamp.position.set(x, y + 2.4, z + 2.4);
    lamps.push(lamp);
    group.add(lamp);
  }
  const glow = new THREE.MeshStandardMaterial({ color: 0xffd7a1, emissive: 0xffb15a, emissiveIntensity: 0.2 });
  windows.push(glow);
  return { group, sign };
}

function buildFloor(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { group: THREE.Group; tape: THREE.Mesh } {
  const spot = areaById("trading-floor");
  const x = spot?.x ?? -42;
  const z = spot?.z ?? -8;
  const y = heightAt(x, z);
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x243044, roughness: 0.7 });
  const room = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.6, 4.6), stone);
  room.position.set(x, y + 1.3, z);
  room.castShadow = !low;
  const tapeMat = new THREE.MeshBasicMaterial({ color: 0x102033 });
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.5), tapeMat);
  tape.position.set(x, y + 1.7, z + 2.32);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x1b2836, roughness: 0.5 }));
  desk.position.set(x, y + 0.7, z + 1.2);
  group.add(room, tape, desk);
  for (const dx of [-2.2, 0, 2.2]) {
    const glow = new THREE.MeshStandardMaterial({ color: 0x7dffa8, emissive: 0x39d98a, emissiveIntensity: 0.35 });
    windows.push(glow);
    const pixel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), glow);
    pixel.position.set(x + dx, y + 1.7, z + 2.2);
    group.add(pixel);
  }
  if (!low) {
    const lamp = new THREE.PointLight(0x7dffa8, 0.12, 9);
    lamp.position.set(x, y + 2.2, z);
    lamps.push(lamp);
    group.add(lamp);
  }
  return { group, tape };
}
