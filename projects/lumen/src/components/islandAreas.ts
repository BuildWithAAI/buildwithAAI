import * as THREE from "three";

type Height = (x: number, z: number) => number;

/** Original meshes for the five added areas. No imported models. */
export function addExpandedAreas(scene: THREE.Scene, low: boolean, heightAt: Height, windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[]): { stall: THREE.Mesh; plants: THREE.Object3D[]; shells: THREE.Object3D; fireflies: THREE.Points; beam: THREE.Mesh } {
  const beach = buildBeach(low, heightAt);
  const forest = buildForest(low, heightAt);
  const garden = buildGarden(low, heightAt, windows, lamps);
  const market = buildMarket(low, heightAt, windows);
  const light = buildLighthouse(low, heightAt, windows, lamps);
  scene.add(beach.group, forest.group, garden.group, market.group, light.group);
  return { stall: market.stall, plants: garden.plants, shells: beach.shells, fireflies: forest.fireflies, beam: light.beam };
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
