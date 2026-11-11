import * as THREE from "three";
import {
  CHUNK_TILES,
  CHUNK_WORLD,
  TILE_COLOR,
  TILE_HEIGHT,
  chunkOrigin,
  tileWorld,
  unpackTiles,
  type PublicChunk,
  type PublicGuest,
} from "../world/chunkMath";

/** Tile meshes for every loaded chunk except 0,0, which is the island itself. */
export function syncChunkLayer(group: THREE.Group, chunks: PublicChunk[]): void {
  const sig = chunks.map((chunk) => `${chunk.cx},${chunk.cy}:${chunk.tiles.length}:${chunk.decor.length}`).join("|");
  if (group.userData.sig === sig) return;
  disposeChildren(group);
  group.userData.sig = sig;
  for (const chunk of chunks) {
    if (chunk.cx === 0 && chunk.cy === 0) continue;
    if (chunk.private) {
      group.add(veil(chunk.cx, chunk.cy));
      continue;
    }
    const mesh = meshFor(chunk);
    if (mesh) group.add(mesh);
    for (const decor of chunk.decor) group.add(decorMesh(chunk.cx, chunk.cy, decor.tx, decor.ty, decor.hue, decor.size));
  }
}

/** Small guests. They are not jellyfish and they are not Zoora. */
export function syncGuestLayer(group: THREE.Group, guests: PublicGuest[], heightAt: (x: number, z: number) => number): void {
  const sig = guests.map((guest) => `${guest.id}:${guest.cx}:${guest.cy}:${guest.tx}:${guest.ty}:${guest.speech}`).join("|");
  if (group.userData.sig === sig) return;
  disposeChildren(group);
  group.userData.sig = sig;
  guests.forEach((guest, index) => {
    const spot = tileWorld(guest.cx, guest.cy, guest.tx, guest.ty);
    const ground = guest.cx === 0 && guest.cy === 0 ? heightAt(spot.x, spot.z) : -0.2;
    const body = creatureMesh(guest.creature, guest.color);
    body.position.set(spot.x, ground + 0.35, spot.z);
    body.userData.baseY = body.position.y;
    body.userData.phase = index * 0.7;
    const label = nameSprite(guest.name, guest.speech);
    label.position.y = 0.7;
    body.add(label);
    group.add(body);
  });
}

export function bobGuests(group: THREE.Group, time: number): void {
  for (const child of group.children) {
    const base = child.userData.baseY;
    const phase = child.userData.phase;
    if (typeof base !== "number" || typeof phase !== "number") continue;
    child.position.y = base + Math.sin(time * 2.1 + phase) * 0.05;
  }
}

function meshFor(chunk: PublicChunk): THREE.Mesh | null {
  const tiles = unpackTiles(chunk.tiles);
  if (!tiles) return null;
  const geo = new THREE.PlaneGeometry(CHUNK_WORLD, CHUNK_WORLD, CHUNK_TILES, CHUNK_TILES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tint = new THREE.Color();
  const origin = chunkOrigin(chunk.cx, chunk.cy);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) + origin.x + CHUNK_WORLD / 2;
    const z = pos.getZ(i) + origin.z + CHUNK_WORLD / 2;
    const tx = Math.min(CHUNK_TILES - 1, Math.max(0, Math.floor((x - origin.x) / (CHUNK_WORLD / CHUNK_TILES))));
    const ty = Math.min(CHUNK_TILES - 1, Math.max(0, Math.floor((z - origin.z) / (CHUNK_WORLD / CHUNK_TILES))));
    const kind = tiles[ty * CHUNK_TILES + tx] ?? "water";
    pos.setY(i, TILE_HEIGHT[kind]);
    tint.set(TILE_COLOR[kind]);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  );
  mesh.position.set(origin.x + CHUNK_WORLD / 2, 0, origin.z + CHUNK_WORLD / 2);
  mesh.name = `${chunk.cx},${chunk.cy}`;
  return mesh;
}

function decorMesh(cx: number, cy: number, tx: number, ty: number, hue: number, size: number): THREE.Mesh {
  const spot = tileWorld(cx, cy, tx, ty);
  const color = new THREE.Color().setHSL(((hue % 360) + 360) % 360 / 360, 0.45, 0.55);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6 + size * 0.4, 0.4 + size * 0.5, 0.6 + size * 0.3),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  mesh.position.set(spot.x, 0.4, spot.z);
  return mesh;
}

function creatureMesh(creature: PublicGuest["creature"], color: string): THREE.Group {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const clay = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.55, emissive: tint, emissiveIntensity: 0.15 });
  if (creature === "crab") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.28), clay);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), clay);
    claw.position.set(0.24, 0, 0.08);
    group.add(body, claw);
  } else if (creature === "minnow") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), clay);
    body.scale.set(1.8, 0.7, 0.55);
    group.add(body);
  } else if (creature === "lantern") {
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), clay);
    glow.position.y = 0.12;
    group.add(glow);
  } else if (creature === "pebble") {
    group.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), clay));
  } else {
    group.add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.18, 0), clay));
  }
  return group;
}

function nameSprite(name: string, speech: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = speech ? 96 : 64;
  const ctx = canvas.getContext("2d");
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(18, 28, 32, 0.72)";
    ctx.fillRect(8, 8, 240, canvas.height - 16);
    ctx.fillStyle = "#f7fff4";
    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name.slice(0, 24), 128, speech ? 36 : 42);
    if (speech) {
      ctx.font = "18px sans-serif";
      ctx.fillText(speech.slice(0, 42), 128, 68);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
  }
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, speech ? 0.6 : 0.4, 1);
  return sprite;
}

/** A soft reef line at the real claim boundary, and a fainter line at the buffer. */
export function syncTerritoryGlow(group: THREE.Group, radius: number, buffer: number): void {
  const sig = `${radius}:${buffer}`;
  if (group.userData.sig === sig) return;
  disposeChildren(group);
  group.userData.sig = sig;
  group.add(reefLine((radius + 0.5) * CHUNK_WORLD, 0xc46b7a));
  group.add(reefLine((radius + buffer + 0.5) * CHUNK_WORLD, 0x8fd0c8));
}

function reefLine(extent: number, color: number): THREE.LineLoop {
  const points = [
    new THREE.Vector3(-extent, 1.6, -extent),
    new THREE.Vector3(extent, 1.6, -extent),
    new THREE.Vector3(extent, 1.6, extent),
    new THREE.Vector3(-extent, 1.6, extent),
  ];
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }),
  );
}

function veil(cx: number, cy: number): THREE.Mesh {
  const origin = chunkOrigin(cx, cy);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CHUNK_WORLD * 0.96, CHUNK_WORLD * 0.96),
    new THREE.MeshBasicMaterial({ color: 0x12343c, transparent: true, opacity: 0.45, fog: false, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(origin.x + CHUNK_WORLD / 2, 0.4, origin.z + CHUNK_WORLD / 2);
  return mesh;
}

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object: THREE.Object3D): void {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose?.();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else if (material) {
    const mapped = material as THREE.MeshStandardMaterial;
    mapped.map?.dispose();
    material.dispose();
  }
  for (const child of [...object.children]) disposeObject(child);
}
