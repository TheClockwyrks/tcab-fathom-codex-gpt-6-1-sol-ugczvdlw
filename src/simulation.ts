import * as C from "./constants";
import {
  center,
  choices,
  derive,
  enter,
  locate,
  neighbor,
  open,
  opposite,
  random,
  resetRun,
  roster,
  setCell,
  speedOf,
  tile,
  VECTORS,
} from "./model";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  Pulse,
  ReadState,
} from "./model";
import type { DeepReadonly } from "ts-essentials";
export interface Controls {
  held: Direction[];
  sonar: boolean;
  ink: boolean;
}
const EPS = 1e-7;
const down = (n: number) => (n - C.TICK_DT < EPS ? 0 : n - C.TICK_DT);
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** Grid traversal includes every cell crossed, excluding the destination rock for passive light. */
export function lineClear(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  landOnRock = false,
): boolean {
  const ax = (a.x - C.GRID_ORIGIN_X) / C.TILE,
    ay = (a.y - C.GRID_ORIGIN_Y) / C.TILE;
  const bx = (b.x - C.GRID_ORIGIN_X) / C.TILE,
    by = (b.y - C.GRID_ORIGIN_Y) / C.TILE;
  let x = Math.floor(ax),
    y = Math.floor(ay);
  const endX = Math.floor(bx),
    endY = Math.floor(by);
  const dx = bx - ax,
    dy = by - ay,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx),
    deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let nextX = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) * deltaX;
  let nextY = dy === 0 ? Infinity : (sy > 0 ? y + 1 - ay : ay - y) * deltaY;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS + 4; i++) {
    if (x === endX && y === endY) return landOnRock || tile(s, x, y) !== "#";
    if (tile(s, x, y) === "#") return false;
    if (Math.abs(nextX - nextY) < EPS) {
      if (tile(s, x + sx, y) === "#" || tile(s, x, y + sy) === "#")
        return false;
      x += sx;
      y += sy;
      nextX += deltaX;
      nextY += deltaY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += deltaX;
    } else {
      y += sy;
      nextY += deltaY;
    }
  }
  return false;
}
export function flooded(
  s: ReadState,
  tx: number,
  ty: number,
  den = false,
): Map<number, number> {
  const found = new Map<number, number>();
  if (!open(s, tx, ty, den)) return found;
  const queue = [{ tx, ty }];
  found.set(ty * C.GRID_COLS + tx, 0);
  for (let i = 0; i < queue.length; i++) {
    const b = queue[i];
    const d = found.get(b.ty * C.GRID_COLS + b.tx)!;
    for (const dir of choices(s, { ...center(b.tx, b.ty), dir: "up" }, den)) {
      const n = neighbor(s, b.tx, b.ty, dir),
        key = n.ty * C.GRID_COLS + n.tx;
      if (!found.has(key)) {
        found.set(key, d + 1);
        queue.push(n);
      }
    }
  }
  return found;
}
function path(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const distances = flooded(s, target.tx, target.ty, den);
  let best = Infinity;
  let result: Direction | null = null;
  for (const d of choices(s, b, den)) {
    const n = neighbor(s, b.tx, b.ty, d),
      v = distances.get(n.ty * C.GRID_COLS + n.tx) ?? Infinity;
    if (v < best) {
      best = v;
      result = d;
    }
  }
  return result;
}
function wander(s: FathomState, b: Body, den = false): Direction | null {
  const dirs = choices(s, b, den);
  const forward = dirs.filter((d) => d !== opposite(b.dir));
  const pool = forward.length ? forward : dirs;
  return pool.length ? pool[Math.floor(random(s) * pool.length)] : null;
}
function atCenter(b: Body): boolean {
  const c = center(b.tx, b.ty);
  return Math.abs(c.x - b.x) < EPS && Math.abs(c.y - b.y) < EPS;
}
/** Integrate to each center exactly, so no turn can cut a corner or overshoot a wall. */
function move(
  s: FathomState,
  b: Body,
  speed: number | (() => number),
  decide: () => Direction | null,
  den = false,
  onTurn?: (old: Direction, next: Direction) => void,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let left = C.TICK_DT,
    moved = false;
  while (left > EPS) {
    if (atCenter(b)) {
      const old = b.dir;
      const d = decide();
      if (d === null) break;
      b.dir = d;
      onTurn?.(old, d);
    }
    const [dx, dy] = VECTORS[b.dir];
    const axis = dx !== 0 ? b.x - C.GRID_ORIGIN_X : b.y - C.GRID_ORIGIN_Y;
    const sign = dx || dy;
    const offset = (((axis - C.TILE / 2) % C.TILE) + C.TILE) % C.TILE;
    const remain =
      sign > 0
        ? offset < EPS
          ? C.TILE
          : C.TILE - offset
        : offset < EPS
          ? C.TILE
          : offset;
    const rate = typeof speed === "number" ? speed : speed();
    const step = Math.min(rate * left, remain);
    b.x += dx * step;
    b.y += dy * step;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    locate(b);
    left -= step / rate;
    moved = true;
    if (step === remain) {
      const c = center(b.tx, b.ty);
      b.x = c.x;
      b.y = c.y;
    }
  }
  return moved;
}
function blinded(s: ReadState, p: DeepReadonly<Predator>): boolean {
  const f = s.forager,
    dx = f.x - p.x,
    dy = f.y - p.y,
    den = dx * dx + dy * dy;
  return s.inkClouds.some((c) => {
    const t =
      den === 0
        ? 0
        : Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / den));
    return Math.hypot(p.x + t * dx - c.x, p.y + t * dy - c.y) <= c.radius;
  });
}
function acquire(
  s: FathomState,
  p: Predator,
  target = s.forager,
  fresh = false,
) {
  if (fresh || p.state !== "chase") {
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
  }
  p.state = "chase";
  p.fix = { tx: target.tx, ty: target.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flaring) p.fade = 0.35;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
    p.flareLeft = 0;
  }
  const d = path(s, p, p.fix);
  if (d === opposite(p.dir)) p.dir = d;
}
function giveUp(p: Predator) {
  p.state = "wander";
  p.fix = null;
  p.hearingLock = p.kind === "gloamfin" ? false : null;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function cast(
  s: FathomState,
  source: Pulse["source"],
  tint: Pulse["tint"],
  b: Body,
  range: number,
  owner: number | null = null,
) {
  s.pulses.push({
    source,
    tint,
    ox: b.tx,
    oy: b.ty,
    range,
    front: 0,
    owner,
    caught: false,
  });
}
function ping(
  s: FathomState,
  p: Predator,
  index: number,
  orange: boolean,
  cues: Set<C.CueName>,
) {
  cast(
    s,
    "gloamfin",
    orange ? "orange" : "violet",
    p,
    C.GLOAMFIN_PING_RANGE,
    index,
  );
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  cues.add(C.CUES.predatorPing);
}
function mind(
  s: FathomState,
  p: Predator,
  index: number,
  cues: Set<C.CueName>,
) {
  p.alertLeft = down(p.alertLeft);
  p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  p.mark = down(p.mark);
  p.fade = down(p.fade);
  if (!p.mind) return;
  if (p.state === "den") return;
  if (p.kind === "gloamfin") {
    const heard = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    const lost = p.hearingLock && !heard;
    p.hearingLock = heard;
    p.pingIn = down(p.pingIn);
    p.pingGap += C.TICK_DT;
    if (heard) acquire(s, p);
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (
        p.searchTime >= C.GLOAMFIN_SEARCH_DELAY &&
        !p.searchPing &&
        p.pingGap >= C.GLOAMFIN_PING_MIN_GAP &&
        !heard
      ) {
        ping(s, p, index, true, cues);
        p.searchPing = true;
      }
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) giveUp(p);
    }
    if (
      !heard &&
      (p.pingIn === 0 || lost) &&
      p.pingGap >= C.GLOAMFIN_PING_MIN_GAP
    )
      ping(s, p, index, false, cues);
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
  } else {
    const blind = blinded(s, p),
      dist = distance(p, s.forager);
    const sees =
      !blind && dist <= (p.detectRange ?? 0) && lineClear(s, p, s.forager);
    const bloomLock = !blind && p.flaring && dist <= C.FLARE_RADIUS;
    if (blind) {
      if (p.state === "chase") giveUp(p);
    } else if (sees || bloomLock) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) giveUp(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flareCharging || p.flaring) {
        p.flareLeft = down(p.flareLeft);
        if (p.flareLeft === 0) {
          if (p.flareCharging) {
            p.flareCharging = false;
            p.flaring = true;
            p.flareLeft = C.FLARE_BLOOM;
            p.flareRadius = C.FLARE_RADIUS;
            cues.add(C.CUES.flare);
            if (!blind && dist <= C.FLARE_RADIUS) acquire(s, p);
          } else {
            p.flaring = false;
            p.flareRadius = 0;
            p.flareIn = C.FLARE_INTERVAL;
            p.fade = 0.35;
          }
        }
      } else {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) {
          p.flareCharging = true;
          p.flareLeft = C.FLARE_CHARGE;
        }
      }
    }
  }
}
function travelPredator(s: FathomState, p: Predator) {
  if (!p.mind || !p.travel) return;
  const den = p.state === "den";
  if (den) {
    if (!p.released || !s.tiles.some((r) => r.includes("d"))) return;
    const gateY = s.tiles.findIndex((r) => r.includes("g"));
    if (gateY < 0) return;
    const gateX = s.tiles[gateY].indexOf("g");
    const exit = choices(s, { ...center(gateX, gateY), dir: "up" }, true)
      .map((d) => neighbor(s, gateX, gateY, d))
      .find((n) => tile(s, n.tx, n.ty) === ".");
    if (!exit) return;
    move(s, p, p.speed, () => path(s, p, exit, true), true);
    if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  const decide = () => {
    if (p.state === "chase" && p.fix) {
      if (p.tx === p.fix.tx && p.ty === p.fix.ty) {
        if (
          p.kind === "gloamfin" &&
          (p.tx !== s.forager.tx || p.ty !== s.forager.ty)
        ) {
          p.state = "search";
          p.searchTime = 0;
          p.searchPing = false;
        } else return null;
      } else return path(s, p, p.fix);
    }
    if (p.state === "search" && p.fix) {
      const d =
        flooded(s, p.fix.tx, p.fix.ty).get(p.ty * C.GRID_COLS + p.tx) ??
        Infinity;
      if (d >= C.GLOAMFIN_SEARCH_ROAM) return path(s, p, p.fix);
    }
    return wander(s, p);
  };
  move(
    s,
    p,
    () => speedOf(p),
    decide,
    false,
    (old, next) => {
      if (
        p.kind === "gloamfin" &&
        p.state === "chase" &&
        old !== next &&
        opposite(old) !== next
      )
        p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
    },
  );
}
function pulseTick(s: FathomState) {
  for (const pulse of s.pulses) {
    const before = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const map = flooded(s, pulse.ox, pulse.oy);
    const reached = (tx: number, ty: number) => {
      const d = map.get(ty * C.GRID_COLS + tx);
      return (
        d !== undefined &&
        d <= pulse.range &&
        d <= pulse.front &&
        (d > before || (d === 0 && before === 0))
      );
    };
    if (pulse.source === "forager") {
      for (const [key, d] of map)
        if (
          d <= pulse.range &&
          d <= pulse.front &&
          (d > before || (d === 0 && before === 0))
        ) {
          const tx = key % C.GRID_COLS,
            ty = Math.floor(key / C.GRID_COLS);
          setCell(s.visibility, tx, ty, "l");
          for (const [dx, dy] of Object.values(VECTORS))
            if (
              tile(s, tx + dx, ty + dy) === "#" &&
              tx + dx >= 0 &&
              tx + dx < C.GRID_COLS &&
              ty + dy >= 0 &&
              ty + dy < C.GRID_ROWS
            )
              setCell(s.visibility, tx + dx, ty + dy, "l");
        }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p, s.forager, true);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") acquire(s, p, s.forager, true);
      pulse.caught = true;
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
export function illuminate(s: FathomState) {
  const blooms = s.predators.filter((p) => p.flaring);
  const light = (x: number, y: number) =>
    distance(s.forager, { x, y }) <= s.visionRadius &&
    lineClear(s, s.forager, { x, y }, true);
  const flare = (b: { x: number; y: number }) =>
    blooms.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const c = center(tx, ty);
      if (light(c.x, c.y) || flare(c)) setCell(s.visibility, tx, ty, "l");
    }
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (light(center(p.tx, p.ty).x, center(p.tx, p.ty).y) ||
        flare(p) ||
        p.mark > 0 ||
        p.alert);
  for (const d of s.drifters)
    d.lit = light(center(d.tx, d.ty).x, center(d.tx, d.ty).y) || flare(d);
}
function attempt(s: FathomState) {
  s.forager = { ...center(17, 15), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.playTime = 0;
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  enter(s, "countdown");
}
/** A tick has no canvas, host clock, or input dependency. */
export function tick(s: FathomState, controls: Controls): Set<C.CueName> {
  const cues = new Set<C.CueName>();
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown") {
    s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
    illuminate(s);
    s.screenLeft = down(s.screenLeft);
    if (s.screenLeft === 0) {
      enter(s, "playing");
      s.playTime = 0;
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return cues;
  }
  if (s.screen === "cleared") {
    s.screenLeft = down(s.screenLeft);
    if (s.screenLeft === 0) {
      const next = resetRun(s, "countdown");
      next.depth = s.depth + 1;
      next.score = s.score;
      next.lives = s.lives;
      next.predators = roster(next.depth);
      Object.assign(s, derive(next));
    }
    return cues;
  }
  if (s.screen !== "playing") return cues;
  s.playTime += C.TICK_DT;
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  const decay = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= 0.5 ** (decay / C.BRIGHT_HALFLIFE);
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (controls.held.length) {
    if (controls.held.includes(s.desired) === false)
      s.desired = controls.held[controls.held.length - 1];
    if (s.desired === opposite(s.forager.dir)) s.forager.dir = s.desired;
    s.forager.moving = move(s, s.forager, C.FORAGER_SPEED, () => {
      const dirs = choices(s, s.forager);
      return dirs.includes(s.desired)
        ? s.desired
        : dirs.includes(s.forager.dir)
          ? s.forager.dir
          : null;
    });
  } else s.forager.moving = false;
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*" && tile(s, f.tx, f.ty) === ".") {
    setCell(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      enter(s, "cleared");
      cues.add(C.CUES.descend);
    }
  }
  derive(s);
  if (controls.sonar && s.sonar.cooldown === 0) {
    cast(s, "forager", "cyan", s.forager, s.sonar.range);
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (controls.ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  for (const [i, p] of s.predators.entries()) {
    if (p.releaseAt !== null && !p.released && s.playTime + EPS >= p.releaseAt)
      p.released = true;
    mind(s, p, i, cues);
  }
  derive(s);
  for (const p of s.predators) travelPredator(s, p);
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(
        s,
        d,
        C.DRIFTER_SPEED,
        () => wander(s, d),
        tile(s, d.tx, d.ty) === "g",
      );
  pulseTick(s);
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const y = s.tiles.findIndex((r) => r.includes("g"));
    if (y >= 0) {
      const x = s.tiles[y].indexOf("g");
      s.drifters.push({
        ...center(x, y),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  s.drifters = s.drifters.filter((d) => {
    if (d.tx === f.tx && d.ty === f.ty) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (
    s.screen === "playing" &&
    s.predators.some((p) => p.state !== "den" && p.tx === f.tx && p.ty === f.ty)
  ) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) enter(s, "gameover");
    else {
      s.lives--;
      attempt(s);
    }
  }
  derive(s);
  illuminate(s);
  return cues;
}
