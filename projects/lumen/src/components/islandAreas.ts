import * as THREE from "three";
import { areaById } from "../world/areas";

type Height = (x: number, z: number) => number;

/** Original meshes for the added areas. No imported models. */
export function addExpandedAreas(scene: THREE.Scene, low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): {
  stall: THREE.Mesh;
  plants: THREE.Object3D[];
  shells: THREE.Object3D;
  fireflies: THREE.Points;
  beam: THREE.Mesh;
  screen: THREE.Mesh;
  pin: THREE.Mesh;
  tape: THREE.Mesh;
  saloonSign: THREE.Mesh;
  doors: THREE.Object3D[];
  paintTape: (lines: string[]) => void;
} {
  const beach = buildBeach(low, heightAt);
  const forest = buildForest(low, heightAt);
  const garden = buildGarden(low, heightAt, windows, lamps);
  const market = buildMarket(low, heightAt, windows);
  const light = buildLighthouse(low, heightAt, windows, lamps);
  const research = buildResearch(low, heightAt, windows, lamps);
  const saloon = buildSaloon(low, heightAt, windows);
  const floor = buildFloor(low, heightAt);
  scene.add(beach.group, forest.group, garden.group, market.group, light.group, research.group, saloon.group, floor.group);
  return {
    stall: market.stall,
    plants: garden.plants,
    shells: beach.shells,
    fireflies: forest.fireflies,
    beam: light.beam,
    screen: research.screen,
    pin: research.pin,
    tape: floor.tape,
    saloonSign: saloon.sign,
    doors: saloon.doors,
    paintTape: floor.paint,
  };
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

function buildSaloon(low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[]): { group: THREE.Group; sign: THREE.Mesh; doors: THREE.Object3D[] } {
  const spot = areaById("solana-saloon");
  const x = spot?.x ?? 19;
  const z = spot?.z ?? 40;
  const y = heightAt(x, z);
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a4b2f, roughness: 0.82, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.45 });
  const purple = new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.5 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 4.4), new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.9 }));
  floor.position.set(x, y + 0.04, z);
  const back = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.8, 0.16), wood);
  back.position.set(x, y + 1.45, z - 2.05);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.8, 4.2), wood);
  left.position.set(x - 3.05, y + 1.45, z);
  const right = left.clone();
  right.position.x = x + 3.05;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.14, 4.8), purple);
  roof.position.set(x, y + 2.95, z);
  const falseFront = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.15, 0.16), trim);
  falseFront.position.set(x, y + 3.45, z + 2.15);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.1, 1.5), wood);
  porch.position.set(x, y + 0.12, z + 2.7);
  group.add(floor, back, left, right, roof, falseFront, porch);
  for (const dx of [-2.6, 2.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14), purple);
    post.position.set(x + dx, y + 1.3, z + 3.15);
    group.add(post);
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf3e2b8, roughness: 0.4 });
  const paneMat = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, emissive: 0x14b8a6, emissiveIntensity: 0.55, roughness: 0.2 });
  windows.push(paneMat);
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.15), frameMat);
    frame.position.set(x + side * 3.12, y + 1.7, z);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.7), paneMat);
    pane.position.set(x + side * 3.18, y + 1.7, z);
    pane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const frontFrame = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.08), frameMat);
    frontFrame.position.set(x + side * 1.85, y + 1.85, z + 2.16);
    const frontPane = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), paneMat);
    frontPane.position.set(x + side * 1.85, y + 1.85, z + 2.22);
    group.add(frame, pane, frontFrame, frontPane);
  }
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b3a22, roughness: 0.65 });
  const doors: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(x + side * 0.52, y + 0.85, z + 2.12);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.35, 0.07), doorMat);
    wing.position.x = side * -0.25;
    hinge.add(wing);
    hinge.rotation.y = side * -0.45;
    doors.push(hinge);
    group.add(hinge);
  }
  const signBoard = signTexture("SOLANA SALOON", "#3b0764", "#5eead4", "#f8f1d0");
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.72), new THREE.MeshBasicMaterial({ map: signBoard }));
  sign.position.set(x, y + 3.48, z + 2.26);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.8 });
  for (const dx of [-1.7, 1.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), railMat);
    post.position.set(x + dx, y + 0.5, z + 4.15);
    group.add(post);
  }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), railMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(x, y + 0.82, z + 4.15);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9a5b32, roughness: 0.75 });
  const hoop = new THREE.MeshStandardMaterial({ color: 0x5eead4, metalness: 0.4, roughness: 0.35 });
  for (const dx of [-2.35, 2.45]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.55, low ? 6 : 8), barrelMat);
    barrel.position.set(x + dx, y + 0.32, z + 3.35);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 8), hoop);
    band.rotation.x = Math.PI / 2;
    band.position.copy(barrel.position);
    group.add(barrel, band);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.55), new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.45 }));
  bar.position.set(x, y + 0.55, z - 1.35);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc56b }));
  bulb.position.set(x, y + 2.35, z - 0.4);
  const lamp = new THREE.PointLight(0xffb15a, 2.4, 9);
  lamp.position.copy(bulb.position);
  group.add(sign, rail, bar, bulb, lamp);
  return { group, sign, doors };
}

function buildFloor(low: boolean, heightAt: Height): { group: THREE.Group; tape: THREE.Mesh; paint: (lines: string[]) => void } {
  const spot = areaById("trading-floor");
  const x = spot?.x ?? -42;
  const z = spot?.z ?? -8;
  const y = heightAt(x, z);
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.62, side: THREE.DoubleSide });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.08, 5), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }));
  deck.position.set(x, y + 0.04, z);
  const back = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.7, 0.14), shell);
  back.position.set(x, y + 1.4, z - 2.3);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.7, 4.6), shell);
  left.position.set(x - 3.55, y + 1.4, z);
  const right = left.clone();
  right.position.x = x + 3.55;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 5.1), new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.45 }));
  roof.position.set(x, y + 2.8, z);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x99f6e4, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide }),
  );
  glass.position.set(x, y + 1.45, z + 2.35);
  const frame = new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.35 });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.12, 0.12), frame);
  lintel.position.set(x, y + 2.6, z + 2.35);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.1, 0.12), frame);
  sill.position.set(x, y + 0.28, z + 2.35);
  group.add(deck, back, left, right, roof, glass, lintel, sill);
  const signBoard = signTexture("ZOORA TRADING FLOOR", "#042f2e", "#c4b5fd", "#f8fafc");
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.62), new THREE.MeshBasicMaterial({ map: signBoard }));
  sign.position.set(x, y + 3.15, z + 2.42);
  const screen = quoteBoard(["PAPER", "— — —", "— — —"]);
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.7), new THREE.MeshBasicMaterial({ map: screen.texture }));
  tape.position.set(x, y + 1.65, z - 2.18);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: 0x134e4a, roughness: 0.45 }));
  desk.position.set(x + 0.2, y + 0.78, z + 0.15);
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.45, 6), new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.5 }));
  stool.position.set(x + 0.2, y + 0.28, z + 0.7);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.22, low ? 8 : 12, 8), new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.35, emissive: 0x14b8a6, emissiveIntensity: 0.35 }));
  bell.position.set(x + 0.2, y + 1.15, z + 0.55);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc4b5fd, roughness: 0.4 }));
  cap.position.set(x + 0.2, y + 1.38, z + 0.55);
  const glow = new THREE.PointLight(0x5eead4, 1.6, 8);
  glow.position.set(x, y + 2.2, z - 1.2);
  group.add(sign, tape, desk, stool, bell, cap, glow);
  return { group, tape, paint: screen.paint };
}

function signTexture(title: string, bg: string, accent: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 160);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 18, 160);
    ctx.fillRect(1006, 0, 18, 160);
    ctx.fillStyle = ink;
    ctx.font = "700 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 512, 84);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function quoteBoard(lines: string[]): { texture: THREE.CanvasTexture; paint: (next: string[]) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = (next: string[]) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#07141c";
    ctx.fillRect(0, 0, 768, 320);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(28, 22, 150, 42);
    ctx.fillStyle = "#1c1917";
    ctx.font = "700 26px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("PAPER", 48, 51);
    const rows = next.filter((line) => line !== "PAPER");
    const shown = rows.length ? rows : ["— — —", "— — —"];
    shown.slice(0, 4).forEach((line, index) => {
      const empty = line.includes("—");
      ctx.fillStyle = empty ? "#64748b" : "#99f6e4";
      ctx.font = index === shown.length - 1 && !empty ? "22px sans-serif" : "32px sans-serif";
      ctx.fillText(line.slice(0, 36), 36, 110 + index * 48);
    });
    texture.needsUpdate = true;
  };
  paint(lines);
  return { texture, paint };
}
