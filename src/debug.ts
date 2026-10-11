import * as C from "./constants";
import {
  center,
  copy,
  derive,
  DIRS,
  enter,
  fresh,
  items,
  makePredator,
  roster,
  setCell,
  tile,
} from "./model";
import type {
  Direction,
  FathomState,
  PredatorKind,
  ReadState,
  Screen,
} from "./model";
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function menuRect(s: ReadState, index: number): Rect | null {
  return Number.isInteger(index) && index >= 0 && index < items(s.screen).length
    ? { x: 480, y: 410 + index * 60, w: 320, h: 48 }
    : null;
}
function requireValue(valid: boolean, message: string): void {
  if (!valid) throw new RangeError(`Fathom: ${message}`);
}
function number(n: number, min = 0, max = Infinity, whole = false) {
  requireValue(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!whole || Number.isInteger(n)),
    "value outside domain",
  );
}
function boolean(b: boolean) {
  requireValue(typeof b === "boolean", "expected boolean");
}
function enumValue<T extends string>(v: T, values: readonly T[]) {
  requireValue(values.includes(v), "unknown value");
}
function position(s: ReadState, tx: number, ty: number, allowed = ".") {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  requireValue(allowed.includes(tile(s, tx, ty)), "tile closed to subject");
}
function pose(s: ReadState, change: (s: FathomState) => void): FathomState {
  const n = copy(s);
  change(n);
  return derive(n);
}
function predator(s: ReadState, i: number) {
  number(i, 0, s.predators.length - 1, true);
}
function drifter(s: ReadState, i: number) {
  number(i, 0, s.drifters.length - 1, true);
}
export const debug = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s: ReadState) => fresh(s.muted),
  snapshot(s: ReadState) {
    const n = derive(copy(s));
    return {
      version: n.version,
      screen: n.screen,
      menuIndex: n.menuIndex,
      titleIndex: n.titleIndex,
      depth: n.depth,
      score: n.score,
      lives: n.lives,
      muted: n.muted,
      planktonRemaining: n.planktonRemaining,
      drifterIn: n.drifterIn,
      brightness: n.brightness,
      brightHold: n.brightHold,
      visionRadius: n.visionRadius,
      windowRadius: n.windowRadius,
      sonar: n.sonar,
      ink: n.ink,
      grid: n.grid,
      tiles: n.tiles,
      plankton: n.plankton,
      visibility: n.visibility,
      forager: n.forager,
      drifters: n.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
        x,
        y,
        tx,
        ty,
        lit,
        mind,
        travel,
      })),
      predators: n.predators.map(
        ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }) => ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }),
      ),
      pulses: n.pulses.map(({ source, tint, ox, oy, front, range }) => ({
        source,
        tint,
        ox,
        oy,
        front,
        range,
      })),
      inkClouds: n.inkClouds,
      simTime: n.simTime,
    };
  },
  reconcile: (s: ReadState) => derive(copy(s)),
  setScreen(s: ReadState, v: Screen) {
    enumValue(v, [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ]);
    return pose(s, (n) => {
      enter(n, v);
      if (v === "playing" && s.screen !== "paused") n.playTime = 0;
    });
  },
  setMenuIndex(s: ReadState, i: number) {
    number(i, 0, items(s.screen).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = i;
    });
  },
  setTitleIndex(s: ReadState, i: number) {
    number(i, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = i;
    });
  },
  menuItemRect: menuRect,
  setScore(s: ReadState, v: number) {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = v;
    });
  },
  setLives(s: ReadState, v: number) {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = v;
    });
  },
  setDepth(s: ReadState, v: number) {
    number(v, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = v;
      n.predators = roster(v);
    });
  },
  setMaze(s: ReadState, rows: readonly string[]) {
    requireValue(
      rows.length === C.GRID_ROWS &&
        rows.every((r) => r.length === C.GRID_COLS && /^[#.gd]+$/.test(r)),
      "invalid maze",
    );
    const all = rows.join("");
    requireValue(
      !/[dg]/.test(all) || [...all].filter((c) => c === "g").length === 1,
      "den requires exactly one gate",
    );
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton(s: ReadState, tx: number, ty: number, present: boolean) {
    position(s, tx, ty);
    boolean(present);
    return pose(s, (n) => {
      setCell(n.plankton, tx, ty, present ? "*" : "-");
    });
  },
  clearPlankton: (s: ReadState) =>
    pose(s, (n) => {
      n.plankton = n.plankton.map((r) => "-".repeat(r.length));
    }),
  clearFog: (s: ReadState) =>
    pose(s, (n) => {
      n.visibility = n.visibility.map((r) => "u".repeat(r.length));
    }),
  setForagerTile(s: ReadState, tx: number, ty: number) {
    position(s, tx, ty);
    return pose(s, (n) => {
      Object.assign(n.forager, center(tx, ty), { moving: false });
    });
  },
  setForagerDir(s: ReadState, dir: Direction) {
    enumValue(dir, DIRS);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.forager.moving = false;
      n.desired = dir;
    });
  },
  setBrightness(s: ReadState, v: number) {
    number(v, 0, 1);
    return pose(s, (n) => {
      n.brightness = v;
    });
  },
  setBrightHold(s: ReadState, v: number) {
    number(v, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = v;
    });
  },
  clearPredators: (s: ReadState) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator(s: ReadState, kind: PredatorKind, tx: number, ty: number) {
    enumValue(kind, C.DEN_ORDER);
    position(s, tx, ty);
    return pose(s, (n) => {
      n.predators.push(makePredator(kind, tx, ty));
    });
  },
  setPredatorTile(s: ReadState, i: number, tx: number, ty: number) {
    predator(s, i);
    position(s, tx, ty, ".dg");
    return pose(s, (n) => {
      Object.assign(n.predators[i], center(tx, ty));
    });
  },
  setPredatorDir(s: ReadState, i: number, dir: Direction) {
    predator(s, i);
    enumValue(dir, DIRS);
    return pose(s, (n) => {
      n.predators[i].dir = dir;
    });
  },
  setPredatorState(s: ReadState, i: number, v: "den" | "wander" | "chase") {
    predator(s, i);
    enumValue(v, ["den", "wander", "chase"]);
    const p = s.predators[i];
    position(s, p.tx, p.ty, v === "den" ? "dg" : ".");
    return pose(s, (n) => {
      const p = n.predators[i];
      p.state = v;
      p.fix = v === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = C.LINGER_TIME;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.lit = v === "den" ? false : p.lit;
    });
  },
  setPredatorReleased(s: ReadState, i: number, v: boolean) {
    predator(s, i);
    boolean(v);
    return pose(s, (n) => {
      n.predators[i].released = v;
    });
  },
  setPredatorMind(s: ReadState, i: number, v: boolean) {
    predator(s, i);
    boolean(v);
    return pose(s, (n) => {
      n.predators[i].mind = v;
    });
  },
  setPredatorTravel(s: ReadState, i: number, v: boolean) {
    predator(s, i);
    boolean(v);
    return pose(s, (n) => {
      n.predators[i].travel = v;
    });
  },
  spawnDrifter(s: ReadState, tx: number, ty: number) {
    position(s, tx, ty);
    return pose(s, (n) => {
      n.drifters.push({
        ...center(tx, ty),
        dir: "up",
        mind: true,
        travel: true,
        lit: false,
      });
    });
  },
  clearDrifters: (s: ReadState) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind(s: ReadState, i: number, v: boolean) {
    drifter(s, i);
    boolean(v);
    return pose(s, (n) => {
      n.drifters[i].mind = v;
    });
  },
  setDrifterTravel(s: ReadState, i: number, v: boolean) {
    drifter(s, i);
    boolean(v);
    return pose(s, (n) => {
      n.drifters[i].travel = v;
    });
  },
  setDrifterIn(s: ReadState, v: number) {
    number(v, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = v;
    });
  },
  setSonarCooldown(s: ReadState, v: number) {
    number(v);
    return pose(s, (n) => {
      n.sonar.cooldown = v;
    });
  },
  setInkCooldown(s: ReadState, v: number) {
    number(v);
    return pose(s, (n) => {
      n.ink.cooldown = v;
    });
  },
};
export type FathomDebugApi = typeof debug;
