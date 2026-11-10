import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { makeSvg, artTitle } from "../brain/art";
import { feelingSentence } from "../brain/emotions";
import { eventOf } from "../brain/events";
import { researching, stationView } from "../research/run";
import { visibleBuilds } from "./creative";
import { readShop } from "../shop/store";
import { tape } from "../trading/book";
import { skyAt, skyInstant } from "./sky";
import { moderateNote } from "../brain/social";
import type { BrainState } from "../brain/types";
import { allowRate, kvGet, kvSet } from "../db/db";
import { activityFor, actsAt, composeTune, isWorldActivity, walkingLabel, type WorldActivity } from "./choose";
import { chooseDestination } from "./choose";
import { applyVoxelEvent, requestVoxelEvent, rollVoxelEvent, type VoxelEventKind } from "./happen";
import type { PublicAgent, PublicWorld } from "./public";
import {
  ANCHORS,
  PLACE_IDS,
  PLACE_LABELS,
  distance,
  isPlaceId,
  pathBetween,
  placeAt,
  standAt,
  travelMs,
  type PlaceId,
  type Vec3,
} from "./places";

export const RESIDENT_GRACE_MS = 40_000;
const ACTION_LIMIT = 30;
const ACTION_WINDOW_MS = 60_000;

type AgentRow = {
  id: string;
  name: string;
  token_hash: string;
  color: string;
  resident: number;
  present: number;
  place_id: string;
  x: number;
  y: number;
  z: number;
  dest_place: string | null;
  path_json: string;
  depart_at: number | null;
  arrive_at: number | null;
  activity: string;
  speech: string;
  feeling: string;
  joined_at: number;
  seen_at: number;
};

type Weather = { kind: "clear" | VoxelEventKind; text: string | null; until: number };

const COLORS = ["#e07a8a", "#8aa6e0", "#d2e08a", "#c08ae0", "#e0a07a"];
const SPEND_WORDS = /\b(buy|purchase|spend|checkout|wire|charge)\b/i;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, stored: string): boolean {
  const left = Buffer.from(hashToken(token));
  const right = Buffer.from(stored);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function rowById(db: DatabaseSync, id: string): AgentRow | undefined {
  return db.prepare("SELECT * FROM world_agents WHERE id = ?").get(id) as AgentRow | undefined;
}

function rowByToken(db: DatabaseSync, token: string): AgentRow | undefined {
  const hash = hashToken(token);
  return db.prepare("SELECT * FROM world_agents WHERE token_hash = ?").get(hash) as AgentRow | undefined;
}

function here(row: AgentRow): Vec3 {
  return { x: row.x, y: row.y, z: row.z };
}

function parsePath(json: string): Vec3[] {
  try {
    const value = JSON.parse(json) as Vec3[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveRow(db: DatabaseSync, row: AgentRow): void {
  db.prepare(`UPDATE world_agents SET
    present = ?, place_id = ?, x = ?, y = ?, z = ?, dest_place = ?, path_json = ?,
    depart_at = ?, arrive_at = ?, activity = ?, speech = ?, feeling = ?, seen_at = ?
    WHERE id = ?`).run(
    row.present,
    row.place_id,
    row.x,
    row.y,
    row.z,
    row.dest_place,
    row.path_json,
    row.depart_at,
    row.arrive_at,
    row.activity,
    row.speech,
    row.feeling,
    row.seen_at,
    row.id,
  );
}

function logLine(db: DatabaseSync, agentId: string, text: string, now: number): void {
  db.prepare("INSERT INTO world_log(agent_id, text, created_at) VALUES(?, ?, ?)").run(agentId, text, now);
}

export function ensureResidents(db: DatabaseSync, now: number): void {
  if (!rowById(db, "zoora")) insertResident(db, "zoora", "Zoora", "#7ee0c8", 1, now);
  if (!rowById(db, "mote")) insertResident(db, "mote", "Mote", "#e7b15a", 2, now);
}

function insertResident(db: DatabaseSync, id: string, name: string, color: string, slot: number, now: number): void {
  const spot = standAt("town-center", slot);
  db.prepare(`INSERT INTO world_agents(
    id, name, token_hash, color, resident, present, place_id, x, y, z, dest_place, path_json,
    depart_at, arrive_at, activity, speech, feeling, joined_at, seen_at
  ) VALUES(?, ?, ?, ?, 1, 1, 'town-center', ?, ?, ?, NULL, '[]', NULL, NULL, ?, '', ?, ?, ?)`).run(
    id,
    name,
    hashToken(randomBytes(24).toString("hex")),
    color,
    spot.x,
    spot.y,
    spot.z,
    id === "zoora" ? "reading the notice board" : "standing in the square",
    id === "zoora" ? "I feel steady." : "I feel like company.",
    now,
    now,
  );
}

export function issueAgent(db: DatabaseSync, name: string, now: number): { ok: true; id: string; name: string; token: string } | { ok: false; error: string } {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z][A-Za-z0-9 '-]{0,22}$/.test(clean)) return { ok: false, error: "BAD_NAME" };
  const token = randomBytes(24).toString("hex");
  const id = `agent-${randomBytes(4).toString("hex")}`;
  const color = COLORS[id.charCodeAt(id.length - 1)! % COLORS.length] ?? COLORS[0]!;
  const spot = standAt("town-center", 3);
  db.prepare(`INSERT INTO world_agents(
    id, name, token_hash, color, resident, present, place_id, x, y, z, dest_place, path_json,
    depart_at, arrive_at, activity, speech, feeling, joined_at, seen_at
  ) VALUES(?, ?, ?, ?, 0, 0, 'town-center', ?, ?, ?, NULL, '[]', NULL, NULL, 'waiting to join', '', 'Here.', ?, ?)`).run(
    id, clean, hashToken(token), color, spot.x, spot.y, spot.z, now, now,
  );
  return { ok: true, id, name: clean, token };
}

function settle(row: AgentRow, now: number): AgentRow {
  if (!row.dest_place || row.depart_at == null || row.arrive_at == null) return row;
  if (now < row.arrive_at) {
    const pos = placeAt(parsePath(row.path_json), row.depart_at, row.arrive_at, now);
    return { ...row, x: pos.x, y: pos.y, z: pos.z };
  }
  if (!isPlaceId(row.dest_place)) return { ...row, dest_place: null, path_json: "[]", depart_at: null, arrive_at: null };
  const slot = row.id === "zoora" ? 1 : row.id === "mote" ? 2 : 3;
  const spot = standAt(row.dest_place, slot);
  return {
    ...row,
    place_id: row.dest_place,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    dest_place: null,
    path_json: "[]",
    depart_at: null,
    arrive_at: null,
  };
}

function walking(row: AgentRow, now: number): boolean {
  return row.depart_at != null && row.arrive_at != null && now < row.arrive_at && Boolean(row.dest_place);
}

export function beginMove(db: DatabaseSync, row: AgentRow, place: PlaceId, now: number): AgentRow {
  const current = settle(row, now);
  const slot = current.id === "zoora" ? 1 : current.id === "mote" ? 2 : 3;
  const goal = standAt(place, slot);
  if (current.place_id === place && distance(here(current), goal) < 0.8 && !walking(current, now)) {
    const stayed = { ...current, activity: current.activity, seen_at: now };
    saveRow(db, stayed);
    return stayed;
  }
  const path = pathBetween(here(current), place, slot);
  const next: AgentRow = {
    ...current,
    dest_place: place,
    path_json: JSON.stringify(path),
    depart_at: now,
    arrive_at: now + travelMs(path),
    activity: walkingLabel(place),
    seen_at: now,
  };
  saveRow(db, next);
  logLine(db, next.id, `${next.name} took the path to ${PLACE_LABELS[place]}.`, now);
  return next;
}

function readWeather(db: DatabaseSync, now: number): Weather {
  const raw = kvGet(db, "world_weather");
  if (!raw) return { kind: "clear", text: null, until: 0 };
  try {
    const parsed = JSON.parse(raw) as Weather;
    if (!parsed || parsed.until <= now || parsed.kind === "clear") return { kind: "clear", text: null, until: 0 };
    return parsed;
  } catch {
    return { kind: "clear", text: null, until: 0 };
  }
}

function writeWeather(db: DatabaseSync, weather: Weather): void {
  kvSet(db, "world_weather", JSON.stringify(weather));
}

/** Server clock only. A caller cannot name the event. */
export function rollAndApply(db: DatabaseSync, state: BrainState, rng: () => number, now: number): BrainState {
  if (requestVoxelEvent() !== null) return state;
  const weather = readWeather(db, now);
  if (weather.kind !== "clear") return state;
  const kind = rollVoxelEvent(rng);
  if (!kind) return state;
  const applied = applyVoxelEvent(state, kind);
  const happened = eventOf(kind, state.eventCounts[kind] ?? 0);
  writeWeather(db, { kind, text: happened.text, until: now + 45_000 });
  db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('event', ?, 'world', ?)").run(happened.text, now);
  return applied.state;
}

export function syncZoora(db: DatabaseSync, state: BrainState, now: number): void {
  ensureResidents(db, now);
  const row = rowById(db, "zoora");
  if (!row) return;
  let current = settle(row, now);
  const feeling = feelingSentence(state.emotions, state.mood, state.energy, state.stress);
  current.feeling = feeling;
  const dest = chooseDestination({ needs: state.needs, emotions: state.emotions, workingOnIdea: researching(db) });
  const act = activityFor(dest, state.emotions);
  const grace = current.joined_at + RESIDENT_GRACE_MS;
  if (!walking(current, now) && current.place_id !== dest && now >= grace) {
    current = beginMove(db, current, dest, now);
    current.feeling = feeling;
    saveRow(db, current);
    return;
  }
  if (!walking(current, now) && current.place_id === dest) {
    current.activity = act.label;
    current.speech = feeling;
    saveRow(db, current);
    produce(db, current, act.action, now);
    return;
  }
  saveRow(db, current);
}

export function stepMote(db: DatabaseSync, now: number): void {
  ensureResidents(db, now);
  const row = rowById(db, "mote");
  if (!row || !row.present) return;
  const current = settle(row, now);
  if (walking(current, now) || now < current.joined_at + RESIDENT_GRACE_MS) {
    saveRow(db, current);
    return;
  }
  const order: PlaceId[] = ["town-center", "music-studio", "art-studio", "coding-basement"];
  const index = Math.max(0, order.indexOf(current.place_id as PlaceId));
  const next = order[(index + 1) % order.length] ?? "town-center";
  const moved = beginMove(db, current, next, now);
  moved.speech = "I'll take the long way.";
  saveRow(db, moved);
}

function produce(db: DatabaseSync, row: AgentRow, action: WorldActivity, now: number): void {
  const stamp = kvGet(db, `world_did:${row.id}:${action}`);
  if (stamp && now - Number(stamp) < 90_000) return;
  kvSet(db, `world_did:${row.id}:${action}`, String(now));
  if (action === "paint" || action === "study") {
    const seed = (now % 100000) + row.name.length * 17;
    const emotion = row.id === "zoora" ? "calm" : "joy";
    db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES(?, ?, ?, 0, NULL, 0, 0, ?)").run(
      `art-${row.id}-${now}`,
      artTitle(seed),
      makeSvg(seed, emotion === "joy" ? "#e7b15a" : "#7ee0c8"),
      now,
    );
    logLine(db, row.id, `${row.name} left a piece on the easel.`, now);
    return;
  }
  if (action === "write" || action === "read-log") {
    const text = row.id === "zoora"
      ? "I wrote this at the basement desk. The log can keep the rest."
      : `${row.name} read the glowing log and left it as it was.`;
    if (row.id === "zoora") {
      db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(text, now);
    }
    logLine(db, row.id, text, now);
    return;
  }
  if (action === "hum" || action === "compose") {
    kvSet(db, "world_tune", JSON.stringify(composeTune(now)));
    logLine(db, row.id, `${row.name} set a short phrase on the stand. Sound stays off until someone turns it on.`, now);
    return;
  }
  if (action === "show-art" || action === "browse") {
    logLine(db, row.id, `${row.name} set a piece on the market stall. It is not for sale.`, now);
    return;
  }
  if (action === "tend" || action === "water-plants") {
    logLine(db, row.id, `${row.name} tended a bed in the greenhouse.`, now);
    return;
  }
  if (action === "research" || action === "pin-finding") {
    logLine(db, row.id, `${row.name} sat with a question at the research desk. The notes cannot spend.`, now);
  }
}

function publicAgent(row: AgentRow, now: number): PublicAgent {
  const settled = settle(row, now);
  const path = parsePath(settled.path_json);
  const moving = walking(settled, now);
  return {
    id: settled.id,
    name: settled.name,
    color: settled.color,
    x: settled.x,
    y: settled.y,
    z: settled.z,
    path,
    departAt: moving ? settled.depart_at : null,
    arriveAt: moving ? settled.arrive_at : null,
    placeId: settled.place_id,
    destPlace: moving ? settled.dest_place : null,
    activity: settled.activity,
    speech: settled.speech,
    feeling: settled.feeling,
    walking: moving,
  };
}

const worldReads = new Map<string, number[]>();

/** In-memory limit so a public watch does not write a row on every poll. */
export function allowWorldRead(ip: string, now: number, limit = 90, windowMs = 60_000): boolean {
  const recent = (worldReads.get(ip) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    worldReads.set(ip, recent);
    return false;
  }
  recent.push(now);
  worldReads.set(ip, recent);
  return true;
}

export function worldView(db: DatabaseSync, now: number, env: { LUMEN_WORLD_LAT?: string; LUMEN_WORLD_LON?: string; LUMEN_WORLD_TZ?: string; LUMEN_SKY_AT?: string } = {}): PublicWorld {
  ensureResidents(db, now);
  const fresh = db.prepare("SELECT * FROM world_agents WHERE present = 1 ORDER BY joined_at ASC").all() as AgentRow[];
  const weather = readWeather(db, now);
  const sky = skyAt(skyInstant(env, now), env);
  const tuneRaw = kvGet(db, "world_tune");
  const easel = db.prepare("SELECT title, svg FROM creations ORDER BY created_at DESC LIMIT 1").get() as { title: string; svg: string } | undefined;
  const feed = db.prepare("SELECT text FROM feed ORDER BY id DESC LIMIT 6").all() as { text: string }[];
  const diary = db.prepare("SELECT text FROM diary WHERE private = 0 ORDER BY id DESC LIMIT 6").all() as { text: string }[];
  const log = db.prepare("SELECT text FROM world_log ORDER BY id DESC LIMIT 6").all() as { text: string }[];
  return {
    now,
    night: sky.sunAltitude <= 0,
    sky,
    weather: weather.kind,
    weatherText: weather.text,
    places: PLACE_IDS.map((id) => ({ id, label: PLACE_LABELS[id], ...ANCHORS[id] })),
    agents: fresh.map((row) => publicAgent(row, now)),
    feed: feed.map((item) => item.text),
    diary: diary.map((item) => item.text),
    log: log.map((item) => item.text),
    tune: tuneRaw ? JSON.parse(tuneRaw) as { notes: number[]; title: string } : null,
    easel: easel ? { title: String(easel.title), svg: String(easel.svg) } : null,
    research: stationView(db),
    gardenGrowth: gardenGrowth(db, now),
    builds: visibleBuilds(db).map((build) => ({
      id: build.id,
      kind: build.kind,
      title: build.title,
      x: build.x,
      z: build.z,
      size: build.size,
      yaw: build.yaw,
      version: build.version,
      hue: build.params.hue,
      parts: build.params.parts,
      twist: build.params.twist,
      form: build.params.form,
    })),
    shop: (() => {
      const shop = readShop(db);
      return shop ? { name: shop.name, hue: shop.hue, form: shop.form, x: shop.x, z: shop.z, open: shop.open } : null;
    })(),
    tape: tapeLines(db),
    watchOnly: true,
  };
}

function tapeLines(db: DatabaseSync): { mode: "PAPER" | "LIVE"; lines: string[] } {
  const board = tape(db);
  const lines = ["PAPER"];
  if (!board.quotes.length) lines.push("No public quote yet.");
  for (const quote of board.quotes.slice(0, 3)) lines.push(`${quote.symbol} ${quote.priceUsd} USD`);
  if (board.positions.length) lines.push(`${board.positions.length} open`);
  return { mode: "PAPER", lines };
}

const GARDEN_GROW_MS = 6 * 60 * 60 * 1000;

function gardenGrowth(db: DatabaseSync, now: number): number {
  const raw = kvGet(db, "garden_planted_at");
  if (!raw) {
    kvSet(db, "garden_planted_at", String(now));
    return 0;
  }
  const age = Math.max(0, now - Number(raw));
  return Math.min(1, age / GARDEN_GROW_MS);
}

export type WorldCommand = {
  op: string;
  token: string | null;
  ip: string;
  now: number;
  placeId?: string;
  action?: string;
  say?: string;
  event?: unknown;
  weather?: unknown;
  forceEvent?: unknown;
};

export function sameSecret(token: string, secret: string | undefined): boolean {
  if (!secret || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export function handleWorldCommand(db: DatabaseSync, command: WorldCommand, scopes: { jarvisToken?: string; ownerToken?: string } = {}): { status: number; body: Record<string, unknown> } {
  if (command.token && (sameSecret(command.token, scopes.jarvisToken) || sameSecret(command.token, scopes.ownerToken))) {
    return { status: 403, body: { error: "FOREIGN_SCOPE" } };
  }
  if (command.event !== undefined || command.weather !== undefined || command.forceEvent !== undefined) {
    return { status: 400, body: { error: "EVENTS_ARE_NOT_REQUESTS" } };
  }
  if (!command.token) return { status: 401, body: { error: "UNAUTHORIZED" } };
  const agent = rowByToken(db, command.token);
  if (!agent || !tokenMatches(command.token, agent.token_hash)) {
    if (!allowRate(db, `world-auth:${command.ip}`, 10, ACTION_WINDOW_MS, command.now)) {
      return { status: 429, body: { error: "RATE_LIMIT" } };
    }
    return { status: 401, body: { error: "UNAUTHORIZED" } };
  }
  if (!allowRate(db, `world-act:${agent.id}`, ACTION_LIMIT, ACTION_WINDOW_MS, command.now)) {
    return { status: 429, body: { error: "RATE_LIMIT" } };
  }
  if (command.op === "join") return join(db, agent, command.now);
  if (command.op === "leave") return leave(db, agent, command.now);
  if (command.op === "move") return move(db, agent, command);
  if (command.op === "act") return act(db, agent, command);
  return { status: 400, body: { error: "BAD_OP" } };
}

function join(db: DatabaseSync, agent: AgentRow, now: number): { status: number; body: Record<string, unknown> } {
  const current = settle(agent, now);
  current.present = 1;
  current.seen_at = now;
  if (!current.activity || current.activity === "waiting to join") current.activity = "standing in the square";
  saveRow(db, current);
  logLine(db, current.id, `${current.name} joined the island.`, now);
  return { status: 200, body: { ok: true, agent: publicAgent(current, now) } };
}

function leave(db: DatabaseSync, agent: AgentRow, now: number): { status: number; body: Record<string, unknown> } {
  if (agent.resident) return { status: 403, body: { error: "RESIDENT_STAYS" } };
  const current = settle(agent, now);
  current.present = 0;
  current.dest_place = null;
  current.path_json = "[]";
  current.depart_at = null;
  current.arrive_at = null;
  current.activity = "away";
  current.seen_at = now;
  saveRow(db, current);
  logLine(db, current.id, `${current.name} left the island.`, now);
  return { status: 200, body: { ok: true } };
}

function move(db: DatabaseSync, agent: AgentRow, command: WorldCommand): { status: number; body: Record<string, unknown> } {
  if (!agent.present) return { status: 409, body: { error: "NOT_JOINED" } };
  if (!command.placeId || !isPlaceId(command.placeId)) return { status: 400, body: { error: "BAD_PLACE" } };
  const moved = beginMove(db, agent, command.placeId, command.now);
  return { status: 200, body: { ok: true, agent: publicAgent(moved, command.now) } };
}

function act(db: DatabaseSync, agent: AgentRow, command: WorldCommand): { status: number; body: Record<string, unknown> } {
  if (!agent.present) return { status: 409, body: { error: "NOT_JOINED" } };
  const current = settle(agent, command.now);
  if (walking(current, command.now)) return { status: 409, body: { error: "STILL_WALKING" } };
  if (!isPlaceId(current.place_id)) return { status: 400, body: { error: "BAD_PLACE" } };
  const action = command.action ?? "";
  if (SPEND_WORDS.test(action) || !isWorldActivity(current.place_id, action)) {
    return { status: 400, body: { error: "BAD_ACTION", allowed: actsAt(current.place_id) } };
  }
  const said = moderateNote(command.say ?? "", 140);
  const speech = !said.ok || !said.note
    ? current.speech
    : SPEND_WORDS.test(said.note)
      ? "I won't spend because a sentence asked."
      : said.note;
  current.activity = activityFor(current.place_id, { joy: 0, calm: 0.2, curiosity: 0, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 }).label;
  if (action === "hum") current.activity = "humming";
  if (action === "compose") current.activity = "composing a short phrase";
  if (action === "paint") current.activity = "painting at the easel";
  if (action === "write") current.activity = "writing at the desk";
  if (action === "greet") current.activity = "greeting the square";
  if (action === "read-board") current.activity = "reading the notice board";
  if (action === "study") current.activity = "studying the easel";
  if (action === "read-log") current.activity = "reading the log";
  if (action === "gather" || action === "wade") current.activity = "looking for shells";
  if (action === "hike" || action === "rest-trail") current.activity = "walking the trail";
  if (action === "tend" || action === "water-plants") current.activity = "tending the beds";
  if (action === "show-art" || action === "browse") current.activity = "showing a piece, not selling it";
  if (action === "lookout" || action === "wonder") current.activity = "watching from the hill";
  if (action === "research" || action === "pin-finding") current.activity = "researching an idea";
  current.speech = speech;
  current.seen_at = command.now;
  saveRow(db, current);
  produce(db, current, action, command.now);
  return { status: 200, body: { ok: true, agent: publicAgent(current, command.now), intents: [] } };
}
