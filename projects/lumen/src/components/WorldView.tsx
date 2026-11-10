"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { addExpandedAreas } from "./islandAreas";
import type { PublicAgent, PublicWorld } from "../world/public";
import type { Vec3 } from "../world/places";
import { directionFromHorizon } from "../world/sky";
import { AREAS } from "../world/areas";
import { WORLD_TIP, WORLD_TIP_KEY, worldTipOpen } from "./visit";

const CAMS: Record<string, { pos: [number, number, number]; look: [number, number, number]; follow?: boolean }> = {
  overview: { pos: [78, 48, 78], look: [0, 1, 4] },
  island: { pos: [8, 168, 28], look: [2, 0, 6] },
  town: { pos: [9, 5.2, 11], look: [0, 1.1, -1] },
  art: { pos: [24, 5.4, 14], look: [25, 1.6, 1] },
  music: { pos: [12, 5.2, 24], look: [0, 1.6, 26] },
  code: { pos: [-16, 5.5, 12], look: [-27, 0.2, 0] },
  together: { pos: [6, 4.2, 8], look: [0, 1.2, 0.4] },
  zoora: { pos: [1.4, 1.55, 3.1], look: [-1.2, 1.05, 0.7] },
  beach: { pos: [44, 6, 6], look: [52, 1.2, -4] },
  forest: { pos: [-34, 8, 28], look: [-48, 2, 40] },
  garden: { pos: [14, 5, -26], look: [22, 1.6, -36] },
  market: { pos: [-24, 5, -18], look: [-34, 1.4, -28] },
  lighthouse: { pos: [18, 8, 46], look: [6, 4, 58] },
  research: { pos: [-4, 5.2, -34], look: [-15, 1.6, -43.2] },
  saloon: { pos: [19, 3.6, 52], look: [19, 2.1, 40] },
  "saloon-in": { pos: [21.4, 1.7, 41], look: [18.2, 1.7, 38.6] },
  floor: { pos: [-42, 3.4, 4], look: [-42, 1.8, -8] },
  "floor-in": { pos: [-42, 1.6, -6.2], look: [-42, 1.55, -10] },
  follow: { pos: [8, 5, 10], look: [0, 1, 0], follow: true },
};

type Board = { texture: THREE.CanvasTexture; paint: (lines: string[]) => void };

export function WorldView({ initial, cam }: { initial: PublicWorld; cam: string }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const world = useRef(initial);
  const [live, setLive] = useState(initial);
  const [sound, setSound] = useState(false);
  const [view, setView] = useState(CAMS[cam] ? cam : "overview");
  const [follow, setFollow] = useState(Boolean(CAMS[cam]?.follow));
  const [lowDetail, setLowDetail] = useState(false);
  const [tip, setTip] = useState(false);
  const viewRef = useRef(view);
  const followRef = useRef(follow);
  const jump = useRef<(name: string) => void>(() => undefined);
  viewRef.current = view;
  followRef.current = follow;

  useEffect(() => {
    let slot = "";
    try {
      slot = window.sessionStorage.getItem("zoora-presence") ?? "";
      if (!/^[a-z0-9]{8,16}$/i.test(slot)) {
        slot = Math.random().toString(36).slice(2, 12).padEnd(8, "a");
        window.sessionStorage.setItem("zoora-presence", slot);
      }
    } catch {
      return;
    }
    const beat = () => {
      fetch("/api/world/here", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot }),
      }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 20_000);
    return () => window.clearInterval(timer);
  }, []);

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
        /* keep the last snapshot */
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
    return () => void audio.close();
  }, [sound, live.tune]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const low = new URLSearchParams(window.location.search).get("quality") === "low" || window.innerWidth < 780 || (nav.deviceMemory != null && nav.deviceMemory <= 4);
    setLowDetail(low);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
    const renderer = new THREE.WebGLRenderer({
      antialias: !low,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const terrain = buildTerrain(low);
    scene.add(terrain);
    const water = buildWater(low ? 28 : 56);
    scene.add(water);
    const windows: THREE.MeshStandardMaterial[] = [];
    const lamps: THREE.PointLight[] = [];
    scene.add(buildTown(windows, lamps, low));
    scene.add(buildArtStudio(windows, lamps, low));
    scene.add(buildMusicStudio(windows, lamps, low));
    scene.add(buildBasement(windows, lamps, low));
    const extra = addExpandedAreas(scene, low, terrainHeight, windows, lamps);
    const questionBoard = boardTexture(["The desk is waiting."], "#102033", "#d7ecff");
    const pinBoard = boardTexture(["No findings yet."], "#f4efe4", "#3a2a18");
    const screenMat = extra.screen.material as THREE.MeshBasicMaterial;
    const pinMat = extra.pin.material as THREE.MeshBasicMaterial;
    screenMat.map = questionBoard.texture;
    screenMat.color.set(0xffffff);
    screenMat.needsUpdate = true;
    pinMat.map = pinBoard.texture;
    pinMat.color.set(0xffffff);
    pinMat.needsUpdate = true;
    extra.paintTape(["PAPER", "— — —", "— — —"]);
    scatterNature(scene, low);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c2 }));
    const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 16), new THREE.MeshBasicMaterial({ color: 0xf4f7ff }));
    const stars = buildStars(low ? 80 : 220);
    scene.add(sunDisc, moonDisc, stars);

    const notice = boardTexture(["The square is open."], "#f3efe4", "#243028");
    const noticeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: notice.texture }));
    noticeMesh.position.set(0, terrainHeight(0, -4.2) + 1.55, -4.2);
    scene.add(noticeMesh);
    const wishes = boardTexture(["Wishlist", "The board is blank."], "#f6f1e4", "#3b2a16");
    const wishMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshBasicMaterial({ map: wishes.texture }));
    wishMesh.position.set(3.4, terrainHeight(3.4, -3.6) + 1.6, -3.6);
    wishMesh.rotation.y = 0.35;
    scene.add(wishMesh);
    const easelBoard = boardTexture(["The easel is waiting."], "#f6e7d4", "#3a2018");
    const easelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.35), new THREE.MeshBasicMaterial({ map: easelBoard.texture }));
    easelMesh.position.set(23.15, terrainHeight(23.15, 1) + 1.35, 1.05);
    easelMesh.rotation.y = -0.5;
    scene.add(easelMesh);
    const diaryBoard = boardTexture(["The desk is quiet."], "#10241c", "#c8ffe2");
    const logBoard = boardTexture(["No log yet."], "#141c28", "#d5e6ff");
    const diaryMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), new THREE.MeshBasicMaterial({ map: diaryBoard.texture }));
    const logMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), new THREE.MeshBasicMaterial({ map: logBoard.texture }));
    diaryMesh.position.set(-27.2, terrainHeight(-27.2, -0.55) + 0.95, -0.55);
    logMesh.position.set(-27.2, terrainHeight(-27.2, 0.7) + 0.95, 0.7);
    diaryMesh.rotation.y = Math.PI / 2;
    logMesh.rotation.y = Math.PI / 2;
    scene.add(diaryMesh, logMesh);

    const ambient = new THREE.HemisphereLight(0xc5e6ff, 0x3d6a45, 0.72);
    const sun = new THREE.DirectionalLight(0xfff1d4, 1.25);
    sun.position.set(28, 36, 14);
    sun.target.position.set(0, 0, 0);
    if (!low) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 8;
      sun.shadow.camera.far = 80;
      sun.shadow.camera.left = -70;
      sun.shadow.camera.right = 70;
      sun.shadow.camera.top = 70;
      sun.shadow.camera.bottom = -70;
      sun.shadow.bias = -0.00015;
      sun.shadow.normalBias = 0.04;
    }
    scene.add(ambient, sun, sun.target);
    const fill = new THREE.DirectionalLight(0x9ecbff, 0.25);
    fill.position.set(-20, 12, -10);
    scene.add(fill);

    const rain = buildRain();
    scene.add(rain);
    const visitor = buildVisitor();
    scene.add(visitor);
    const gem = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: 0xf0c86a, emissive: 0xf0c86a, emissiveIntensity: 0.6, roughness: 0.25 }),
    );
    gem.position.set(8, terrainHeight(8, 0) + 0.28, 0);
    scene.add(gem);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 2.2;
    controls.maxDistance = 240;
    const anim = {
      fromPos: new THREE.Vector3(),
      toPos: new THREE.Vector3(),
      fromLook: new THREE.Vector3(),
      toLook: new THREE.Vector3(),
      started: 0,
      active: false,
    };
    const go = (name: string) => {
      const shot = CAMS[name] ?? CAMS.overview!;
      followRef.current = Boolean(shot.follow);
      setFollow(Boolean(shot.follow));
      anim.fromPos.copy(camera.position);
      anim.fromLook.copy(controls.target);
      anim.toPos.set(...shot.pos);
      anim.toLook.set(...shot.look);
      anim.started = performance.now();
      anim.active = !shot.follow;
      if (shot.follow) anim.active = false;
    };
    jump.current = go;
    const firstLook = viewRef.current === "overview" && worldTipOpen(window.localStorage.getItem(WORLD_TIP_KEY));
    if (firstLook) {
      camera.position.set(...CAMS.island!.pos);
      controls.target.set(...CAMS.island!.look);
      setTip(true);
      window.setTimeout(() => go("town"), 700);
    } else {
      go(viewRef.current);
    }

    const agents = new Map<string, { group: THREE.Group; label: THREE.Sprite; key: string; kind: "jelly" | "mote"; phase: number; glow: THREE.PointLight; mats: THREE.ShaderMaterial[] }>();
    const curves = new Map<string, { key: string; curve: THREE.CatmullRomCurve3 }>();
    const clockOffset = world.current.now - Date.now();
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
    const buildPieces = new Map<string, THREE.Group>();
    const shopPiece: { key: string; group: THREE.Group } | { key: "" } = { key: "" };
    let feedKey = "";
    let wishKey = "";
    let diaryKey = "";
    let logKey = "";
    let svgKey = "";
    let researchKey = "";
    let tapeKey = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const time = performance.now() / 1000;
      const snap = world.current;
      const now = Date.now() + clockOffset;
      const skyState = snap.sky;
      const altitude = skyState?.sunAltitude ?? (snap.night ? -0.4 : 0.8);
      const night = altitude <= 0;
      const colors = skyColors(altitude);
      scene.background = new THREE.Color(colors.sky);
      scene.fog = viewRef.current === "island"
        ? new THREE.Fog(colors.fog, 220, 520)
        : new THREE.FogExp2(colors.fog, night ? 0.012 : 0.01);
      ambient.intensity = colors.ambient;
      ambient.color.set(colors.hemi);
      const sunDir = directionFromHorizon(altitude, skyState?.sunAzimuth ?? 0.4);
      sun.position.set(sunDir.x * 80, Math.max(4, sunDir.y * 80), sunDir.z * 80);
      sun.intensity = colors.sun;
      sun.color.set(colors.sunColor);
      sunDisc.position.copy(sun.position).setLength(95);
      sunDisc.material.color.set(colors.sunColor);
      const moonDir = directionFromHorizon(skyState?.moonAltitude ?? 0.4, skyState?.moonAzimuth ?? -1);
      moonDisc.position.set(moonDir.x * 88, moonDir.y * 88, moonDir.z * 88);
      moonDisc.visible = skyState ? skyState.moonAltitude > -0.05 : night;
      (moonDisc.material as THREE.MeshBasicMaterial).color.set(moonColor(skyState?.moonPhase ?? 0.5));
      stars.visible = altitude < -0.05;
      extra.beam.visible = altitude <= 0;
      extra.beam.rotation.y = time * 0.35;
      const swing = Math.sin(time * 1.6) * 0.55;
      const leftDoor = extra.doors[0];
      const rightDoor = extra.doors[1];
      if (leftDoor) leftDoor.rotation.y = -0.25 - swing;
      if (rightDoor) rightDoor.rotation.y = 0.25 + swing;
      extra.fireflies.visible = altitude <= 0;
      extra.shells.visible = snap.weather === "tide-shell";
      const growth = 0.28 + 0.72 * (snap.gardenGrowth ?? 0) + (snap.weather === "plant-bloom" ? 0.15 : 0);
      for (const plant of extra.plants) plant.scale.setScalar(growth);
      renderer.toneMappingExposure = colors.exposure;
      for (const material of windows) material.emissiveIntensity = night ? 1.35 : 0.12;
      for (const lamp of lamps) lamp.intensity = night ? (low ? 0.8 : 1.5) : 0.08;
      const wave = water.userData.tick as ((time: number) => void) | undefined;
      wave?.(time);
      rain.visible = snap.weather === "rain";
      if (rain.visible) rain.position.y = ((time * 3) % 4) - 1;
      visitor.visible = snap.weather === "visitor";
      gem.visible = snap.weather === "found-item";
      if (snap.feed.join("|") !== feedKey) {
        feedKey = snap.feed.join("|");
        notice.paint(snap.feed.length ? snap.feed : ["The square is open."]);
      }
      const wishLines = snap.wishlist ?? [];
      const nextWish = wishLines.join("|");
      if (nextWish !== wishKey) {
        wishKey = nextWish;
        wishes.paint(wishLines.length ? ["Wishlist", ...wishLines] : ["Wishlist", "The board is blank."]);
      }
      if (snap.diary.join("|") !== diaryKey) {
        diaryKey = snap.diary.join("|");
        diaryBoard.paint(snap.diary.length ? snap.diary : ["The desk is quiet."]);
      }
      if (snap.log.join("|") !== logKey) {
        logKey = snap.log.join("|");
        logBoard.paint(snap.log.length ? snap.log : ["No log yet."]);
      }
      if (snap.easel?.svg && snap.easel.svg !== svgKey) {
        svgKey = snap.easel.svg;
        paintSvg(easelBoard, snap.easel.svg);
      }
      syncBuilds(scene, buildPieces, snap.builds ?? []);
      syncShop(scene, shopPiece, snap.shop ?? null);
      const researchText = `${snap.research?.question ?? ""}|${(snap.research?.pins ?? []).join("|")}`;
      if (researchText !== researchKey) {
        researchKey = researchText;
        questionBoard.paint(wrapLines(snap.research?.question || "The desk is waiting."));
        pinBoard.paint(snap.research?.pins?.length ? snap.research.pins : ["No findings yet."]);
      }
      const tapeText = (snap.tape?.lines ?? ["PAPER", "— — —"]).join("|");
      if (tapeText !== tapeKey) {
        tapeKey = tapeText;
        extra.paintTape(snap.tape?.lines?.length ? snap.tape.lines : ["PAPER", "— — —", "— — —"]);
      }

      const seen = new Set<string>();
      let leader: THREE.Object3D | null = null;
      for (const agent of snap.agents) {
        seen.add(agent.id);
        let entry = agents.get(agent.id);
        if (!entry) {
          entry = agent.name === "Mote" ? makeMote(agent.color) : makeJelly(agent.color, low);
          agents.set(agent.id, entry);
          scene.add(entry.group);
        }
        const pos = visualPosition(agent, now, curves);
        const ground = terrainHeight(pos.x, pos.z);
        const bob = Math.sin(time * (entry.kind === "jelly" ? 1.6 : 2.2) + entry.phase) * (entry.kind === "jelly" ? 0.08 : 0.04);
        entry.group.position.set(pos.x, ground + (entry.kind === "jelly" ? 0.95 : 0.42) + bob, pos.z);
        entry.glow.color.set(agent.color);
        entry.glow.intensity = night ? 1.1 : 0.45;
        for (const material of entry.mats) {
          if (material.uniforms.uTime) material.uniforms.uTime.value = time;
        }
        const tint = entry.group.userData.tint as THREE.MeshStandardMaterial | undefined;
        if (tint) {
          tint.color.set(agent.color);
          tint.emissive.set(agent.color);
          tint.emissiveIntensity = night ? 0.55 : 0.28;
        }
        const text = `${agent.name}\n${agent.activity}\n${agent.feeling || agent.speech}`.slice(0, 180);
        if (entry.key !== text) {
          entry.key = text;
          paintLabel(entry.label, text);
        }
        if (agent.name === "Zoora") leader = entry.group;
      }
      for (const [id, entry] of agents) {
        if (seen.has(id)) continue;
        scene.remove(entry.group);
        agents.delete(id);
        curves.delete(id);
      }

      if (anim.active) {
        const t = ease((performance.now() - anim.started) / 1100);
        camera.position.lerpVectors(anim.fromPos, anim.toPos, t);
        controls.target.lerpVectors(anim.fromLook, anim.toLook, t);
        if (t >= 1) anim.active = false;
      } else if (followRef.current && leader) {
        const desired = leader.position.clone().add(new THREE.Vector3(3.4, 2.4, 4.2));
        camera.position.lerp(desired, 0.06);
        controls.target.lerp(leader.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.1);
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
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  const choose = (name: string) => {
    setView(name);
    if (!CAMS[name]?.follow) setFollow(false);
    jump.current(name);
  };

  return (
    <div className="world-stage">
      <div className="world-canvas" ref={mount} />
      <div className="world-banner">
        <span>{live.sky ? `${live.sky.localTime} · up ${shortTime(live.sky.sunrise, live.sky.tz)} down ${shortTime(live.sky.sunset, live.sky.tz)} · moon ${live.sky.moonPhaseName}` : (live.night ? "Night" : "Day")}</span>
        <span>{live.weather === "clear" ? "Clear paths" : live.weatherText ?? live.weather}</span>
        <span>{live.agents.map((agent) => agent.name).join(" · ") || "No one is here"}</span>
        <span>{lowDetail ? "Light detail" : "Soft shadows"}</span>
        <span>Watching only</span>
      </div>
      {tip ? (
        <div className="world-tip card">
          <p>{WORLD_TIP}</p>
          <button type="button" onClick={() => { window.localStorage.setItem(WORLD_TIP_KEY, "1"); setTip(false); }}>Got it</button>
        </div>
      ) : null}
      <div className="world-hud">
        {["overview", "island", "town", "art", "music", "code", "beach", "forest", "garden", "market", "lighthouse", "research", "saloon", "saloon-in", "floor", "floor-in", "together", "zoora", "follow"].map((name) => (
          <button key={name} type="button" onClick={() => choose(name)}>{name === "follow" && follow ? "following" : name}</button>
        ))}
        <button type="button" onClick={() => setSound((on) => !on)}>{sound ? "Sound on" : "Sound off"}</button>
      </div>
    </div>
  );
}

function wrapLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 28 && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function skyColors(altitude: number): { sky: number; fog: number; hemi: number; sun: number; sunColor: number; ambient: number; exposure: number } {
  if (altitude > 0.45) return { sky: 0x8fd4ea, fog: 0xb7e4ea, hemi: 0xc5e6ff, sun: 1.25, sunColor: 0xfff4cf, ambient: 0.7, exposure: 1.02 };
  if (altitude > 0.12) return { sky: 0xf0b56a, fog: 0xf2c9a0, hemi: 0xffd7b0, sun: 1.05, sunColor: 0xffb15a, ambient: 0.55, exposure: 1 };
  if (altitude > 0) return { sky: 0xe37a62, fog: 0xd98978, hemi: 0xffc2a8, sun: 0.7, sunColor: 0xff8a4a, ambient: 0.4, exposure: 0.92 };
  if (altitude > -0.12) return { sky: 0x3a3f78, fog: 0x4a4570, hemi: 0x8ea0d8, sun: 0.22, sunColor: 0xffb08a, ambient: 0.28, exposure: 0.8 };
  return { sky: 0x12182e, fog: 0x1a2340, hemi: 0x6e88c4, sun: 0.05, sunColor: 0xd7e4ff, ambient: 0.16, exposure: 0.72 };
}

function moonColor(phase: number): number {
  const full = Math.cos((phase - 0.5) * Math.PI * 2);
  return full > 0.35 ? 0xf7f8ff : full > -0.2 ? 0xc5cbe0 : 0x6d7388;
}

function buildStars(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const radius = 120;
    positions[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
    positions[i * 3 + 1] = Math.cos(phi) * radius;
    positions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf7fbff, size: 0.7, sizeAttenuation: false, transparent: true, opacity: 0.85 }));
}

function shortTime(iso: string, tz: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function fade(edge0: number, edge1: number, value: number): number {
  return ease((value - edge0) / Math.max(0.0001, edge1 - edge0));
}

function syncShop(scene: THREE.Scene, holder: { key: string; group?: THREE.Group }, shop: { name: string; hue: number; form: number; x: number; z: number; open: boolean } | null): void {
  if (!shop) return;
  const key = `${shop.name}:${shop.hue}:${shop.form}:${shop.open}`;
  if (holder.key === key) return;
  if (holder.group) scene.remove(holder.group);
  const group = new THREE.Group();
  const color = new THREE.Color().setHSL((shop.hue % 360) / 360, 0.45, 0.55);
  const y = terrainHeight(shop.x, shop.z);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 1.8), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  wall.position.set(shop.x, y + 0.75, shop.z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 4 + (shop.form % 3)), new THREE.MeshStandardMaterial({ color: 0xf2cc8f, roughness: 0.6 }));
  roof.position.set(shop.x, y + 1.8, shop.z);
  roof.rotation.y = shop.form;
  group.add(wall, roof);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  label.position.set(shop.x, y + 2.5, shop.z);
  label.scale.set(2.2, 0.7, 1);
  paintLabel(label, shop.name);
  group.add(label);
  scene.add(group);
  holder.key = key;
  holder.group = group;
}

function syncBuilds(scene: THREE.Scene, pieces: Map<string, THREE.Group>, builds: { id: string; title: string; x: number; z: number; size: number; yaw: number; version?: number; hue?: number; parts?: number; twist?: number; form?: number }[]): void {
  const seen = new Set<string>();
  for (const build of builds) {
    seen.add(build.id);
    const key = `${build.version ?? 1}:${build.hue ?? 0}:${build.form ?? 0}:${build.title}`;
    let group = pieces.get(build.id);
    if (!group || group.userData.key !== key) {
      if (group) scene.remove(group);
      group = makeBuildPiece(build);
      group.userData.key = key;
      pieces.set(build.id, group);
      scene.add(group);
    }
    group.position.set(build.x, terrainHeight(build.x, build.z), build.z);
    group.rotation.y = build.yaw;
  }
  for (const [id, group] of pieces) {
    if (seen.has(id)) continue;
    scene.remove(group);
    pieces.delete(id);
  }
}

function makeBuildPiece(build: { title: string; size: number; hue?: number; parts?: number; twist?: number; form?: number }): THREE.Group {
  const group = new THREE.Group();
  const size = build.size;
  const hue = ((build.hue ?? 150) % 360) / 360;
  const color = new THREE.Color().setHSL(hue, 0.55, 0.62);
  const clay = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.04, emissive: color, emissiveIntensity: 0.25 });
  const parts = Math.max(2, Math.min(6, build.parts ?? 3));
  const twist = build.twist ?? 0;
  const form = (build.form ?? 0) % 6;
  for (let index = 0; index < parts; index += 1) {
    const t = index / parts;
    const height = 0.18 + size * (0.25 + t * 0.7);
    let mesh: THREE.Mesh;
    if (form === 0) mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08 + size * 0.12 * (1 - t), 10, 8), clay);
    else if (form === 1) mesh = new THREE.Mesh(new THREE.ConeGeometry(0.05 + size * 0.12, height, 5), clay);
    else if (form === 2) mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12 + twist, height, 0.08 + size * 0.1), clay);
    else if (form === 3) mesh = new THREE.Mesh(new THREE.TorusGeometry(0.08 + size * 0.1, 0.03, 6, 12), clay);
    else if (form === 4) mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, height, 6), clay);
    else mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + size * 0.1, 0), clay);
    const angle = twist * Math.PI * 2 + index * (Math.PI * 2 / parts);
    mesh.position.set(Math.cos(angle) * size * 0.28, 0.15 + index * (0.12 + size * 0.12), Math.sin(angle) * size * 0.28);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    group.add(mesh);
  }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  label.position.y = size + 0.9;
  label.scale.set(1.8, 0.6, 1);
  paintLabel(label, build.title);
  group.add(label);
  return group;
}

function terrainHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const shore = fade(58, 72, radius);
  const hills = Math.sin(x * 0.11) * Math.cos(z * 0.1) * 0.9 + Math.sin((x + z) * 0.05) * 0.4;
  const hill = Math.exp(-((x - 6) ** 2 + (z - 58) ** 2) / 80);
  let flat = 0;
  for (const area of AREAS) {
    flat = Math.max(flat, Math.exp(-((x - area.x) ** 2 + (z - area.z) ** 2) / 22));
    flat = Math.max(flat, nearSegment(x, z, area.x, area.z, 2.6));
  }
  let height = hills * (1 - flat * 0.92) + hill * 3.2 * (1 - flat);
  const bowl = Math.exp(-((x + 27.5) ** 2 + z * z) / 16);
  height -= bowl * 0.55;
  height = height * (1 - shore) - 2.4 * shore;
  return height;
}

function nearSegment(x: number, z: number, ax: number, az: number, width: number): number {
  const denom = ax * ax + az * az || 1;
  const t = Math.max(0, Math.min(1, (x * ax + z * az) / denom));
  return Math.hypot(x - ax * t, z - az * t) < width ? 1 : 0;
}

function buildTerrain(low: boolean): THREE.Group {
  const group = new THREE.Group();
  const span = 180;
  const chunks = low ? 2 : 3;
  const chunk = span / chunks;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const grass = new THREE.Color("#3f9a62");
  const deep = new THREE.Color("#2c6d46");
  const sand = new THREE.Color("#e6d3a6");
  const soil = new THREE.Color("#c4a574");
  const tint = new THREE.Color();
  for (let ix = 0; ix < chunks; ix += 1) {
    for (let iz = 0; iz < chunks; iz += 1) {
      const cx = -span / 2 + chunk * (ix + 0.5);
      const cz = -span / 2 + chunk * (iz + 0.5);
      const segs = low ? 8 : Math.hypot(cx, cz) < 42 ? 24 : 12;
      const geo = new THREE.PlaneGeometry(chunk, chunk, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i) + cx;
        const z = pos.getZ(i) + cz;
        const height = terrainHeight(x, z);
        pos.setY(i, height);
        const shore = fade(54, 70, Math.hypot(x, z));
        const onPath = AREAS.some((area) => nearSegment(x, z, area.x, area.z, 2.4) > 0) ? 1 : 0;
        tint.copy(grass).lerp(deep, Math.max(0, height) * 0.2).lerp(sand, Math.max(onPath, shore * 0.85)).lerp(soil, Math.max(0, -height) * 0.25);
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(cx, 0, cz);
      mesh.receiveShadow = !low;
      group.add(mesh);
    }
  }
  return group;
}

function buildWater(segs: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(110, segs);
  const material = new THREE.MeshStandardMaterial({ color: 0x1b7c8e, transparent: true, opacity: 0.8, roughness: 0.18, metalness: 0.04 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       transformed.z += sin(transformed.x * 0.32 + uTime * 0.8) * cos(transformed.y * 0.26 + uTime * 0.65) * 0.05;`,
    )}`;
    material.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.05;
  mesh.userData.tick = (time: number) => {
    const shader = material.userData.shader as { uniforms: { uTime?: { value: number } } } | undefined;
    if (shader?.uniforms.uTime) shader.uniforms.uTime.value = time;
  };
  return mesh;
}

function buildTown(windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[], low: boolean): THREE.Group {
  const group = new THREE.Group();
  const y = terrainHeight(0, 0);
  const stone = new THREE.MeshStandardMaterial({ color: 0xd7d0c4, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6240, roughness: 0.7 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(4.4, low ? 20 : 40), new THREE.MeshStandardMaterial({ color: 0xe7d7b0, roughness: 0.95 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = y + 0.03;
  plaza.receiveShadow = !low;
  group.add(plaza);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.38, low ? 12 : 24), stone);
  basin.position.y = y + 0.28;
  basin.castShadow = !low;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.08, 8, low ? 16 : 28), stone);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = y + 0.46;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), new THREE.MeshStandardMaterial({ color: 0x7ec8d4, roughness: 0.15, metalness: 0.05 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = y + 0.42;
  const jet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd7f4ff, transparent: true, opacity: 0.85 }));
  jet.position.y = y + 0.85;
  group.add(basin, lip, pool, jet);
  for (const [x, z] of [[-3.2, -3.2], [3.2, -3.2], [3.2, 3.2], [-3.2, 3.2]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 8), wood);
    post.position.set(x, y + 0.75, z);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb15a, emissiveIntensity: 0.2 }));
    globe.position.set(x, y + 1.6, z);
    windows.push(globe.material as THREE.MeshStandardMaterial);
    group.add(post, globe);
    if (!low) {
      const light = new THREE.PointLight(0xffb15a, 0.1, 6);
      light.position.set(x, y + 1.6, z);
      lamps.push(light);
      group.add(light);
    }
  }
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 8), wood);
  const postR = postL.clone();
  postL.position.set(-1.15, y + 0.7, -4.2);
  postR.position.set(1.15, y + 0.7, -4.2);
  group.add(postL, postR);
  return group;
}

function buildArtStudio(windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[], low: boolean): THREE.Group {
  const group = new THREE.Group();
  const x = 25.4;
  const z = 1;
  const y = terrainHeight(x, z);
  const stucco = new THREE.MeshStandardMaterial({ color: 0xf0d2b4, roughness: 0.86 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc45c3e, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.3, 3.4), stucco);
  body.position.set(x, y + 1.2, z);
  body.castShadow = !low;
  body.receiveShadow = !low;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.35, 4), roofMat);
  roof.position.set(x, y + 2.9, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = !low;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xb7e4ff, emissive: 0xffc48a, emissiveIntensity: 0.15, roughness: 0.08, metalness: 0.02, transparent: true, opacity: 0.88 });
  windows.push(glassMat);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.25, 0.08), new THREE.MeshStandardMaterial({ color: 0xf7f1e6, roughness: 0.5 }));
  frame.position.set(x, y + 1.35, z + 1.72);
  const window = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), glassMat);
  window.position.set(x, y + 1.35, z + 1.77);
  group.add(frame);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.4), new THREE.MeshStandardMaterial({ color: 0x8d5a3c, roughness: 0.6 }));
  door.position.set(x - 2.11, y + 0.75, z);
  door.rotation.y = -Math.PI / 2;
  group.add(body, roof, window, door);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x6b4630 }));
  leg.position.set(23.15, y + 0.55, 1.05);
  leg.rotation.z = 0.15;
  group.add(leg);
  if (!low) {
    const light = new THREE.PointLight(0xffb06a, 0.1, 7);
    light.position.set(x, y + 1.6, z + 1.2);
    lamps.push(light);
    group.add(light);
  }
  return group;
}

function buildMusicStudio(windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[], low: boolean): THREE.Group {
  const group = new THREE.Group();
  const z = 26.2;
  const y = terrainHeight(0, z);
  const timber = new THREE.MeshStandardMaterial({ color: 0xa87445, roughness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6a4328, roughness: 0.55 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.45, 1.7, low ? 12 : 24), timber);
  drum.position.set(0, y + 0.9, z);
  drum.castShadow = !low;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.15, low ? 12 : 24), dark);
  cap.position.set(0, y + 2.15, z);
  cap.castShadow = !low;
  group.add(drum, cap);
  for (let i = 0; i < 6; i += 1) {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 5), new THREE.MeshStandardMaterial({ color: 0xf6edd4, metalness: 0.25, roughness: 0.3 }));
    string.position.set(2.15, y + 1.2, z - 0.7 + i * 0.28);
    group.add(string);
  }
  const hand = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 8, 20, Math.PI), dark);
  hand.position.set(2.15, y + 1.35, z);
  hand.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16), dark);
  head.position.set(-1.6, y + 0.55, z + 1.7);
  group.add(hand, head);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe7c4, emissive: 0xffb36a, emissiveIntensity: 0.12, roughness: 0.25 });
  windows.push(glassMat);
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), glassMat);
  pane.position.set(0, y + 1.15, z + 2.46);
  group.add(pane);
  if (!low) {
    const light = new THREE.PointLight(0xffb36a, 0.1, 7);
    light.position.set(0, y + 1.4, z + 1.5);
    lamps.push(light);
    group.add(light);
  }
  return group;
}

function buildBasement(windows: THREE.MeshStandardMaterial[], lamps: THREE.PointLight[], low: boolean): THREE.Group {
  const group = new THREE.Group();
  const x = -28.2;
  const y = terrainHeight(x, 0);
  const plaster = new THREE.MeshStandardMaterial({ color: 0xd9c7ae, roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4d6a78, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.1, 3.2), plaster);
  body.position.set(x, y + 1.05, 0);
  body.castShadow = !low;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.05, 4), roofMat);
  roof.position.set(x, y + 2.4, 0);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = !low;
  group.add(body, roof);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xd7fff0, emissive: 0x8ef0c4, emissiveIntensity: 0.2, roughness: 0.25 });
  windows.push(glassMat);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.7), glassMat);
  pane.position.set(x + 1.81, y + 1.15, 0);
  pane.rotation.y = Math.PI / 2;
  group.add(pane);
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.8 });
  for (let i = 0; i < 6; i += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 1.5), stepMat);
    const sx = -20.5 - i * 1.05;
    step.position.set(sx, terrainHeight(sx, 0) + 0.08 + i * 0.02, 0);
    step.castShadow = !low;
    group.add(step);
  }
  if (!low) {
    const light = new THREE.PointLight(0x8ef0c4, 0.15, 6);
    light.position.set(x + 1.2, y + 1.2, 0);
    lamps.push(light);
    group.add(light);
  }
  return group;
}

function scatterNature(scene: THREE.Scene, low: boolean): void {
  const trunk = new THREE.MeshStandardMaterial({ color: 0x8d6244, roughness: 0.85 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f8f55, roughness: 0.8 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x8d9088, roughness: 0.95 });
  const spots: [number, number][] = [[12, 14], [-8, 16], [16, -12], [-14, -10], [8, -16], [32, 6], [-8, 32], [20, 16]];
  for (const [x, z] of spots) {
    if (Math.hypot(x, z) > 33) continue;
    const y = terrainHeight(x, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 6), trunk);
    stem.position.set(x, y + 0.55, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), leaf);
    crown.position.set(x, y + 1.45, z);
    crown.scale.y = 0.8;
    stem.castShadow = !low;
    crown.castShadow = !low;
    scene.add(stem, crown);
  }
  for (const [x, z, s] of [[18, -8, 0.55], [-16, 10, 0.4], [7, 18, 0.35]] as const) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
    stone.position.set(x, terrainHeight(x, z) + s * 0.4, z);
    stone.castShadow = !low;
    scene.add(stone);
  }
}

function buildRain(): THREE.Points {
  const count = 180;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 50;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd5f6ff, size: 0.06, transparent: true, opacity: 0.7 }));
  points.visible = false;
  return points;
}

function buildVisitor(): THREE.Group {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd7c4a8, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), cloth);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf0ddc8, roughness: 0.6 }));
  const y = terrainHeight(2.2, -3);
  body.position.set(2.2, y + 0.6, -3);
  head.position.set(2.2, y + 1.15, -3);
  group.add(body, head);
  group.visible = false;
  return group;
}

function makeJelly(color: string, low: boolean): { group: THREE.Group; label: THREE.Sprite; key: string; kind: "jelly"; phase: number; glow: THREE.PointLight; mats: THREE.ShaderMaterial[] } {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const bellMat = new THREE.MeshStandardMaterial({
    color: tint,
    transparent: true,
    opacity: 0.62,
    roughness: 0.18,
    metalness: 0.02,
    emissive: tint,
    emissiveIntensity: 0.32,
    side: THREE.DoubleSide,
  });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.48, low ? 16 : 28, low ? 12 : 20, 0, Math.PI * 2, 0, Math.PI * 0.58), bellMat);
  bell.scale.set(1, 0.72, 1);
  bell.castShadow = !low;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, low ? 12 : 24), bellMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.08;
  group.add(bell, rim);
  const mats: THREE.ShaderMaterial[] = [];
  const count = low ? 5 : 8;
  for (let i = 0; i < count; i += 1) {
    const phase = (i / count) * Math.PI * 2;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: phase },
        uColor: { value: tint.clone() },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPhase;
        varying float vFade;
        void main() {
          vec3 p = position;
          float sway = sin(uTime * 1.7 + uPhase + p.y * 6.0);
          p.x += sway * (0.15 - p.y) * 0.55;
          p.z += cos(uTime * 1.25 + uPhase) * (0.15 - p.y) * 0.4;
          vFade = smoothstep(-0.7, 0.1, p.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, 0.28 + vFade * 0.45);
        }
      `,
    });
    mats.push(material);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.85, low ? 4 : 6), material);
    const angle = phase;
    arm.position.set(Math.cos(angle) * 0.22, -0.48, Math.sin(angle) * 0.22);
    group.add(arm);
  }
  const glow = new THREE.PointLight(tint, 0.6, low ? 3.5 : 6);
  glow.position.y = 0.1;
  group.add(glow);
  group.userData.tint = bellMat;
  const label = makeLabelSprite();
  group.add(label);
  return { group, label, key: "", kind: "jelly", phase: 0.4, glow, mats };
}

function makeMote(color: string): { group: THREE.Group; label: THREE.Sprite; key: string; kind: "mote"; phase: number; glow: THREE.PointLight; mats: THREE.ShaderMaterial[] } {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const bodyMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, emissive: tint, emissiveIntensity: 0.12 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), bodyMat);
  body.scale.set(1.05, 0.82, 0.95);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bodyMat);
  head.position.y = 0.38;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8d5a32, roughness: 0.6 }));
  cap.position.y = 0.48;
  group.add(body, head, cap);
  const glow = new THREE.PointLight(tint, 0.25, 3);
  group.add(glow);
  const label = makeLabelSprite();
  group.add(label);
  return { group, label, key: "", kind: "mote", phase: 1.2, glow, mats: [] };
}

function makeLabelSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  sprite.position.y = 1.15;
  sprite.scale.set(2.6, 0.9, 1);
  return sprite;
}

function visualPosition(agent: PublicAgent, now: number, curves: Map<string, { key: string; curve: THREE.CatmullRomCurve3 }>): { x: number; y: number; z: number } {
  if (!(agent.walking && agent.path.length > 1 && agent.departAt != null && agent.arriveAt != null)) {
    return { x: agent.x, y: agent.y, z: agent.z };
  }
  const key = `${agent.departAt}:${agent.path.length}:${agent.destPlace}`;
  let cached = curves.get(agent.id);
  if (!cached || cached.key !== key) {
    const points = agent.path.map((point: Vec3) => new THREE.Vector3(point.x, terrainHeight(point.x, point.z), point.z));
    cached = { key, curve: new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.2) };
    curves.set(agent.id, cached);
  }
  const span = Math.max(1, agent.arriveAt - agent.departAt);
  const along = ease((now - agent.departAt) / span);
  const point = cached.curve.getPointAt(Math.min(1, Math.max(0, along)));
  return { x: point.x, y: point.y, z: point.z };
}

function paintLabel(sprite: THREE.Sprite, text: string): void {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "rgba(12, 24, 28, 0.72)";
  roundRect(ctx, 24, 18, 464, 144, 28);
  ctx.fill();
  ctx.fillStyle = "#f4fff8";
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  text.split("\n").slice(0, 3).forEach((line, index) => ctx.fillText(line.slice(0, 40), 256, 62 + index * 36));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.map = texture;
  material.needsUpdate = true;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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
    next.slice(0, 5).forEach((line, index) => ctx.fillText(line.slice(0, 32), 24, 58 + index * 48));
    texture.needsUpdate = true;
  };
  paint(lines);
  return { texture, paint };
}

function paintSvg(board: Board, svg: string): void {
  const image = new Image();
  image.onload = () => {
    const canvas = board.texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f6e7d4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 48, 24, 416, 272);
    board.texture.needsUpdate = true;
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
