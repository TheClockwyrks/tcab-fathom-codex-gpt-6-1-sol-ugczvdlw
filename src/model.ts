import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export type PredatorKind = C.PredatorKind;
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Forager extends Body {
  moving: boolean;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Drifter {
  kind: PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  speed: number;
  alert: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  pingIn: number;
  pingGap: number;
  searchTime: number;
  searchPing: boolean;
  chaseSpeed: number;
  flareIn: number;
  flareLeft: number;
  fade: number;
  releaseAt: number | null;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  simTime: number;
  // These clocks and decisions are carried with the value, never in the renderer.
  remainder: number;
  screenLeft: number;
  playTime: number;
  desired: Direction;
  rng: number;
  pointerStarts: Record<number, { screen: Screen; index: number | null }>;
  pendingSonar: boolean;
  pendingInk: boolean;
}
export type ReadState = DeepReadonly<FathomState>;
export const DIRS: Direction[] = ["up", "right", "down", "left"];
export const VECTORS: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRS[(DIRS.indexOf(d) + 2) % 4];
export function center(tx: number, ty: number) {
  return {
    x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
    y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
    tx,
    ty,
  };
}
export function copy(s: ReadState): FathomState {
  return structuredClone(s) as FathomState;
}
export function setCell(rows: string[], tx: number, ty: number, char: string) {
  rows[ty] = rows[ty].slice(0, tx) + char + rows[ty].slice(tx + 1);
}
export function tile(s: ReadState, tx: number, ty: number): string {
  return s.tiles[ty]?.[tx] ?? "#";
}
export function wrapRow(s: ReadState): number {
  return s.tiles.findIndex((r) => r[0] === "." && r[C.GRID_COLS - 1] === ".");
}
export function neighbor(
  s: ReadState,
  tx: number,
  ty: number,
  dir: Direction,
): { tx: number; ty: number } {
  const [dx, dy] = VECTORS[dir];
  let nx = tx + dx;
  if (ty === wrapRow(s)) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return { tx: nx, ty: ty + dy };
}
export function open(s: ReadState, tx: number, ty: number, den = false) {
  const t = tile(s, tx, ty);
  return t === "." || (den && (t === "g" || t === "d"));
}
export function choices(
  s: ReadState,
  b: DeepReadonly<Body>,
  den = false,
): Direction[] {
  return DIRS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return open(s, n.tx, n.ty, den);
  });
}
export function locate(b: Body) {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function maze(): string[] {
  const rows = Array.from({ length: C.GRID_ROWS }, () =>
    Array<string>(C.GRID_COLS).fill("#"),
  );
  for (let y = 1; y <= 15; y++)
    for (let x = 1; x <= 34; x++) {
      if (y % 2 === 1 || [1, 5, 9, 13, 22, 26, 30, 34].includes(x))
        rows[y][x] = ".";
    }
  for (let y = 6; y <= 10; y++) for (let x = 15; x <= 20; x++) rows[y][x] = "#";
  for (let y = 7; y <= 9; y++) for (let x = 16; x <= 19; x++) rows[y][x] = "d";
  rows[6][17] = "g";
  rows[9][0] = ".";
  rows[9][35] = ".";
  // Trim the two one-cell stubs beside the sealed chamber.
  for (const y of [7, 9]) {
    rows[y][14] = "#";
    rows[y][21] = "#";
  }
  return rows.map((r) => r.join(""));
}
export function makePredator(
  kind: PredatorKind,
  tx: number,
  ty: number,
  releaseAt: number | null = null,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: releaseAt === null ? "wander" : "den",
    released: releaseAt === null,
    lit: false,
    mind: true,
    travel: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingGap: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    flareIn: C.FLARE_INTERVAL,
    flareLeft: 0,
    fade: 0,
    releaseAt,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((k, i) =>
    makePredator(k, 16 + (i % 4), 7 + Math.floor(i / 4), i * C.DEN_RELEASE_GAP),
  );
}
export function speedOf(p: DeepReadonly<Predator>): number {
  return p.kind === "lanternjaw" && p.state === "wander"
    ? C.DRIFTER_SPEED
    : p.kind === "gloamfin" && p.state === "chase"
      ? p.chaseSpeed
      : C.PREDATOR_SPEED;
}
export function derive(s: FathomState): FathomState {
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(C.SONAR_RANGE_MIN, C.SONAR_RANGE_BASE - s.depth + 1);
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, r) => n + [...r].filter((c) => c === "*").length,
    0,
  );
  locate(s.forager);
  for (const d of s.drifters) locate(d);
  for (const p of s.predators) {
    locate(p);
    p.speed = speedOf(p);
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return s;
}
export function fresh(muted = false): FathomState {
  const tiles = maze();
  return derive({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: tiles.map((r) => "u".repeat(r.length)),
    forager: { ...center(17, 15), dir: "left", moving: false },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    remainder: 0,
    screenLeft: 2,
    playTime: 0,
    desired: "left",
    rng: 0xfa710,
    pointerStarts: {},
    pendingSonar: false,
    pendingInk: false,
  });
}
export function items(screen: Screen): readonly string[] {
  return screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSE_ITEMS
      : screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function enter(s: FathomState, screen: Screen) {
  s.screen = screen;
  s.menuIndex =
    screen === "title" ? s.titleIndex : items(screen).length ? 0 : null;
  s.screenLeft = 2;
  if (screen === "playing" && s.playTime === 0) s.playTime = 0;
}
export function resetRun(s: FathomState, screen: Screen): FathomState {
  const n = fresh(s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.remainder = s.remainder;
  enter(n, screen);
  return n;
}
