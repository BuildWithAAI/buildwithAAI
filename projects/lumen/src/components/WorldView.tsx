"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PublicWorld } from "../world/public";
import { placeAt } from "../world/places";

const CAMS: Record<string, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [42, 34, 42], look: [0, 0, 0] },
  town: { pos: [12, 8, 14], look: [0, 1, 0] },
  art: { pos: [24, 8, 16], look: [24, 1.5, 1] },
  music: { pos: [14, 8, 24], look: [0, 1.5, 24] },
  code: { pos: [-14, 7, 14], look: [-26, -0.4, 0] },
  together: { pos: [7, 5.5, 9], look: [0.2, 1.3, 0.1] },
};

export function WorldView({ initial, cam }: { initial: PublicWorld; cam: string }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const world = useRef(initial);
  const [live, setLive] = useState(initial);
  const [sound, setSound] = useState(false);
  const [view, setView] = useState(CAMS[cam] ? cam : "overview");
  const viewRef = useRef(view);
  viewRef.current = view;
  const jump = useRef<(name: string) => void>(() => undefined);

  useEffect(() => {
    world.current = live;
  }, [live]);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/world", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as PublicWorld;
        if (!stop) {
          world.current = next;
          setLive(next);
        }
      } catch {
        /* the last snapshot stays on screen */
      }
    };
    const timer = setInterval(() => void pull(), 700);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!sound || !live.tune?.notes.length) return;
    const audio = new AudioContext();
    const start = audio.currentTime + 0.05;
    for (const [index, freq] of live.tune.notes.entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = start + index * 0.28;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    }
    return () => {
      void audio.close();
    };
  }, [sound, live.tune]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: window.innerWidth >= 800, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(window.innerWidth < 800 ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const clockOffset = world.current.now - Date.now();
    const mats = new Map<number, THREE.MeshLambertMaterial>();
    const unit = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const mat = (color: number, extra?: Partial<THREE.MeshLambertMaterialParameters>) => {
      const key = color + (extra?.emissive ? 1 : 0);
      const found = mats.get(key);
      if (found && !extra) return found;
      const made = new THREE.MeshLambertMaterial({ color, ...extra });
      if (!extra) mats.set(color, made);
      return made;
    };
    const voxel = (x: number, y: number, z: number, color: number, extra?: Partial<THREE.MeshLambertMaterialParameters>) => {
      const mesh = new THREE.Mesh(unit, mat(color, extra));
      mesh.position.set(x, y + 0.46, z);
      scene.add(mesh);
      return mesh;
    };

    const moss: number[] = [];
    const sand: number[] = [];
    for (let x = -34; x <= 34; x += 1) {
      for (let z = -34; z <= 34; z += 1) {
        if (x * x + z * z > 34 * 34) continue;
        const pit = x <= -18 && x >= -32 && z >= -5 && z <= 5;
        const path = (Math.abs(z) <= 1 && x >= -16 && x <= 22) || (Math.abs(x) <= 1 && z >= 2 && z <= 22);
        if (pit) continue;
        (path ? sand : moss).push(x, 0, z);
      }
    }
    const scatter = (coords: number[], color: number, y: number) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.4, 0.96), mat(color), coords.length / 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < coords.length; i += 3) {
        dummy.position.set(coords[i]!, y, coords[i + 2]!);
        dummy.updateMatrix();
        mesh.setMatrixAt(i / 3, dummy.matrix);
      }
      scene.add(mesh);
    };
    scatter(moss, 0x1d6a55, -0.2);
    scatter(sand, 0xd8c4a2, -0.12);
    for (let x = -31; x <= -21; x += 1) {
      for (let z = -4; z <= 4; z += 1) voxel(x, -2, z, 0x2a313c);
    }
    for (let i = 0; i < 6; i += 1) {
      for (const z of [-1, 0, 1]) voxel(-17 - i, -i * 0.45, z, 0x5c5346);
    }

    const shell = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, doorX: number | null, doorZ: number | null) => {
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          for (let y = y0; y <= y1; y += 1) {
            const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y1 || y === y0;
            if (!edge) continue;
            const opening = y > y0 && y < y0 + 3 && ((doorX != null && x === doorX && Math.abs(z - (z0 + z1) / 2) < 1.2) || (doorZ != null && z === doorZ && Math.abs(x - (x0 + x1) / 2) < 1.2));
            if (opening) continue;
            voxel(x, y, z, color);
          }
        }
      }
    };
    shell(21, 0, -3, 29, 4, 5, 0xc56b45, 21, null);
    voxel(24, 1, 1, 0x8d4630);
    voxel(25, 1, 1, 0x8d4630);
    const easel = boardTexture(["The easel is waiting."], "#3a2018", "#f4d7b0");
    const easelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.8), new THREE.MeshBasicMaterial({ map: easel.texture }));
    easelMesh.position.set(24.6, 2.1, 1);
    scene.add(easelMesh);

    shell(-4, 0, 21, 4, 4, 29, 0x8a5a32, null, 21);
    for (let i = 0; i < 5; i += 1) voxel(-1 + i * 0.0 + (i - 2) * 0.7, 1, 25, 0xf2e2c4);
    voxel(1, 0, 26, 0x5c3b22);
    voxel(1, 0, 27, 0x5c3b22);

    shell(-31, -2, -4, -21, 2, 4, 0x3c4654, -21, null);
    const diaryBoard = boardTexture(["The desk is quiet."], "#10241c", "#b6ffd9");
    const logBoard = boardTexture(["No log yet."], "#101820", "#d5e4ff");
    const diaryMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshBasicMaterial({ map: diaryBoard.texture }));
    const logMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshBasicMaterial({ map: logBoard.texture }));
    diaryMesh.position.set(-26, -0.5, -2.4);
    logMesh.position.set(-26, -0.5, 1.6);
    diaryMesh.rotation.x = -0.4;
    logMesh.rotation.x = -0.4;
    scene.add(diaryMesh, logMesh);

    const notice = boardTexture(["The square is open."], "#243028", "#e7fff6");
    const noticeMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({ map: notice.texture }));
    noticeMesh.position.set(0, 2.1, -5);
    scene.add(noticeMesh);
    voxel(-2, 0, -5, 0x5c5346);
    voxel(2, 0, -5, 0x5c5346);
    voxel(-2, 1, -5, 0x5c5346);
    voxel(2, 1, -5, 0x5c5346);
    for (const [x, z] of [[-6, -6], [6, -6], [6, 6], [-6, 6]] as const) {
      voxel(x, 0, z, 0x5c5346);
      voxel(x, 1, z, 0x5c5346);
      voxel(x, 2, z, 0xffd27a, { emissive: 0xffd27a, emissiveIntensity: 0.7 });
    }
    const water = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 4), new THREE.MeshLambertMaterial({ color: 0x1c7594, transparent: true, opacity: 0.86 }));
    water.position.set(10, 0.05, 8);
    scene.add(water);

    const visitor = new THREE.Group();
    const body = new THREE.Mesh(unit, mat(0xd7c4a3));
    body.position.set(2.2, 0.9, -3);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mat(0xf0ddc4));
    head.position.set(2.2, 1.7, -3);
    visitor.add(body, head);
    visitor.visible = false;
    scene.add(visitor);
    const gem = voxel(8, 0, 0, 0xe6c36a, { emissive: 0xe6c36a, emissiveIntensity: 0.45 });
    gem.visible = false;

    const rainGeo = new THREE.BufferGeometry();
    const drops = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i += 1) {
      drops[i * 3] = (Math.random() - 0.5) * 50;
      drops[i * 3 + 1] = Math.random() * 16;
      drops[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    rainGeo.setAttribute("position", new THREE.BufferAttribute(drops, 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xd5f4ff, size: 0.08 }));
    rain.visible = false;
    scene.add(rain);

    const ambient = new THREE.AmbientLight(0xc5fff0, 0.55);
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.15);
    sun.position.set(20, 28, 10);
    const hemi = new THREE.HemisphereLight(0x9fd8ff, 0x1d6a55, 0.45);
    scene.add(ambient, sun, hemi);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 4;
    controls.maxDistance = 80;
    const applyCam = (name: string) => {
      const shot = CAMS[name] ?? CAMS.overview!;
      camera.position.set(...shot.pos);
      controls.target.set(...shot.look);
      controls.update();
    };
    applyCam(viewRef.current);
    jump.current = applyCam;

    const agents = new Map<string, { group: THREE.Group; label: THREE.Sprite; key: string }>();
    const resize = () => {
      const width = host.clientWidth || 800;
      const height = host.clientHeight || 520;
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    requestAnimationFrame(resize);

    let frame = 0;
    let feedKey = "";
    let diaryKey = "";
    let logKey = "";
    let svgKey = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const snap = world.current;
      const now = Date.now() + clockOffset;
      const night = snap.night;
      scene.background = new THREE.Color(night ? 0x10182a : 0x8eced4);
      scene.fog = new THREE.Fog(night ? 0x10182a : 0x8eced4, 28, 90);
      ambient.intensity = night ? 0.28 : 0.55;
      sun.intensity = night ? 0.22 : 1.15;
      rain.visible = snap.weather === "rain";
      visitor.visible = snap.weather === "visitor";
      gem.visible = snap.weather === "found-item";
      if (rain.visible) {
        const attr = rainGeo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < 240; i += 1) {
          let y = attr.getY(i) - 0.18;
          if (y < 0) y = 16;
          attr.setY(i, y);
        }
        attr.needsUpdate = true;
      }
      const nextFeed = (snap.feed.length ? snap.feed : ["The square is open."]).join("|");
      const nextDiary = (snap.diary.length ? snap.diary : ["The desk is quiet."]).join("|");
      const nextLog = (snap.log.length ? snap.log : ["No log yet."]).join("|");
      if (nextFeed !== feedKey) { feedKey = nextFeed; paintBoard(notice, nextFeed.split("|")); }
      if (nextDiary !== diaryKey) { diaryKey = nextDiary; paintBoard(diaryBoard, nextDiary.split("|")); }
      if (nextLog !== logKey) { logKey = nextLog; paintBoard(logBoard, nextLog.split("|")); }
      if (snap.easel?.svg && snap.easel.svg !== svgKey) { svgKey = snap.easel.svg; paintSvg(easel, snap.easel.svg); }
      const seen = new Set<string>();
      for (const agent of snap.agents) {
        seen.add(agent.id);
        let entry = agents.get(agent.id);
        if (!entry) {
          entry = makeAgent(agent.color, agent.name);
          agents.set(agent.id, entry);
          scene.add(entry.group);
        }
        const pos = agent.walking && agent.path.length && agent.departAt != null && agent.arriveAt != null
          ? placeAt(agent.path, agent.departAt, agent.arriveAt, now)
          : { x: agent.x, y: agent.y, z: agent.z };
        entry.group.position.set(pos.x, pos.y, pos.z);
        const text = `${agent.name}\n${agent.activity}\n${agent.feeling || agent.speech}`.slice(0, 180);
        if (entry.key !== text) {
          entry.key = text;
          paintLabel(entry.label, text);
        }
      }
      for (const [id, entry] of agents) {
        if (!seen.has(id)) {
          scene.remove(entry.group);
          agents.delete(id);
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="world-stage">
      <div className="world-canvas" ref={mount} />
      <div className="world-banner">
        <span>{live.night ? "Night" : "Day"}</span>
        <span>{live.weather === "clear" ? "Clear paths" : live.weatherText ?? live.weather}</span>
        <span>{live.agents.map((agent) => agent.name).join(" · ") || "No one is here"}</span>
        <span>Watching only</span>
      </div>
      <div className="world-hud">
        {Object.keys(CAMS).map((name) => (
          <button key={name} type="button" onClick={() => { setView(name); jump.current(name); }}>{name}</button>
        ))}
        <button type="button" onClick={() => setSound((on) => !on)}>{sound ? "Sound on" : "Sound off"}</button>
      </div>
    </div>
  );
}

function makeAgent(color: string, name: string): { group: THREE.Group; label: THREE.Sprite; key: string } {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const bell = new THREE.Mesh(new THREE.BoxGeometry(name === "Mote" ? 0.7 : 1.05, name === "Mote" ? 0.7 : 0.62, name === "Mote" ? 0.7 : 1.05), new THREE.MeshLambertMaterial({ color: tint }));
  bell.position.y = name === "Mote" ? 0.7 : 0.85;
  group.add(bell);
  if (name !== "Mote") {
    for (const x of [-0.28, 0, 0.28]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), new THREE.MeshLambertMaterial({ color: tint.clone().multiplyScalar(0.75) }));
      arm.position.set(x, 0.28, 0);
      group.add(arm);
    }
  } else {
    const brim = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.7), new THREE.MeshLambertMaterial({ color: 0x8a5a32 }));
    brim.position.y = 1.1;
    group.add(brim);
  }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  label.position.y = 2.15;
  label.scale.set(3.4, 1.15, 1);
  group.add(label);
  return { group, label, key: "" };
}

function paintLabel(sprite: THREE.Sprite, text: string): void {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "rgba(6, 16, 20, 0.78)";
  ctx.fillRect(16, 16, 480, 148);
  ctx.fillStyle = "#e7fff6";
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  text.split("\n").slice(0, 3).forEach((line, index) => ctx.fillText(line.slice(0, 42), 256, 58 + index * 36));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.map = texture;
  material.needsUpdate = true;
}

type Board = { texture: THREE.CanvasTexture; paint: (lines: string[]) => void };

function boardTexture(lines: string[], paper: string, ink: string): Board {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = (next: string[]) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = ink;
    ctx.font = "28px sans-serif";
    next.slice(0, 5).forEach((line, index) => ctx.fillText(line.slice(0, 32), 24, 56 + index * 48));
    texture.needsUpdate = true;
  };
  paint(lines);
  return { texture, paint };
}

function paintBoard(board: Board, lines: string[]): void {
  board.paint(lines);
}

function paintSvg(board: Board, svg: string): void {
  const image = new Image();
  image.onload = () => {
    const canvas = board.texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f4d7b0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 40, 20, 432, 280);
    board.texture.needsUpdate = true;
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
