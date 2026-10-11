/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { createGame } from "./game";
import { debug } from "./debug";
import { center, choices, copy, fresh, tile } from "./model";
import type { FathomState, Direction } from "./model";
import { flooded, lineClear, tick } from "./simulation";
const still = { held: [] as Direction[], sonar: false, ink: false };
function step(s: FathomState, count = 1, held: Direction[] = []) {
  for (let i = 0; i < count; i++) tick(s, { ...still, held });
  return s;
}
function fixture(rows: Record<number, string>, forager = [3, 3]): FathomState {
  let s = fresh();
  const maze = Array.from({ length: C.GRID_ROWS }, (_, y) =>
    (rows[y] ?? "").padEnd(C.GRID_COLS, "#"),
  );
  s = debug.setMaze(s, maze);
  s = debug.clearPlankton(s);
  s = debug.clearPredators(s);
  s = debug.setScreen(s, "playing");
  s = debug.setForagerTile(s, ...(forager as [number, number]));
  return s;
}
function corridor() {
  return fixture({ 3: "#.................." }, [3, 3]);
}
describe("maze and authoritative state", () => {
  it("lays out a connected, symmetric, single-width maze with no dead ends and the prescribed proportions", () => {
    const s = fresh();
    const cells = [];
    const runs: number[] = [];
    const visited = new Set<number>();
    let neighbors = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = tile(s, x, y),
          mirror = tile(s, C.GRID_COLS - 1 - x, y);
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t === ".") {
          const dirs = choices(s, { ...center(x, y), dir: "up" });
          expect(dirs.length).toBeGreaterThanOrEqual(2);
          neighbors += dirs.length;
          cells.push({ x, y });
          expect(
            [tile(s, x + 1, y), tile(s, x, y + 1), tile(s, x + 1, y + 1)].every(
              (c) => c === ".",
            ),
          ).toBe(false);
        }
        if (t === "d") {
          expect(x >= 16 && x <= 19 && y >= 7 && y <= 9).toBe(true);
          expect(choices(s, { ...center(x, y), dir: "up" })).toHaveLength(0);
        }
      }
    const degree = (x: number, y: number) =>
      choices(s, { ...center(x, y), dir: "up" }).length;
    for (const { x, y } of cells) {
      const key = y * C.GRID_COLS + x;
      if (visited.has(key) || degree(x, y) !== 2) continue;
      const queue = [{ tx: x, ty: y }];
      visited.add(key);
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = (b.tx + dx + C.GRID_COLS) % C.GRID_COLS,
            ny = b.ty + dy,
            k = ny * C.GRID_COLS + nx;
          if (
            tile(s, nx, ny) === "." &&
            degree(nx, ny) === 2 &&
            !visited.has(k)
          ) {
            visited.add(k);
            queue.push({ tx: nx, ty: ny });
          }
        }
      }
      runs.push(queue.length);
    }
    const openness = neighbors / cells.length,
      mazing = runs.reduce((a, b) => a + b, 0) / runs.length,
      density = cells.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2));
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(mazing).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mazing).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(density).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(density).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
    expect(flooded(s, 17, 15).size).toBe(cells.length);
    expect(s.tiles.join("").match(/g/g)).toHaveLength(1);
    expect(s.tiles.join("").match(/d/g)).toHaveLength(12);
    expect(
      s.tiles.filter((r) => r[0] === "." && r[C.GRID_COLS - 1] === "."),
    ).toHaveLength(1);
  });
  it("poses immutably, validates domains, and reconciles without sensing or consuming time", () => {
    const s = fresh(),
      serialized = JSON.stringify(s);
    let n = debug.setBrightness(s, 1);
    n = debug.clearFog(n);
    n = debug.reconcile(n);
    expect(JSON.stringify(s)).toBe(serialized);
    expect(n.windowRadius).toBe(C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN);
    expect(n.visionRadius).toBe(C.VISION_MIN + C.VISION_GAIN);
    expect(n.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(n.simTime).toBe(0);
    expect(debug.reconcile(n)).toEqual(n);
    expect(() => debug.setMenuIndex(n, 2)).toThrow();
    expect(() => debug.setBrightness(n, 1.1)).toThrow();
    expect(() => debug.setScore(n, -1)).toThrow();
    expect(() => debug.setLives(n, 1.2)).toThrow();
    expect(() => debug.setMaze(n, ["bad"])).toThrow();
    expect(() => debug.setForagerTile(n, 0, 0)).toThrow();
    expect(() => debug.setPredatorMind(n, 8, false)).toThrow();
  });
  it("reset restores the whole dive while retaining mute only", () => {
    let s = fresh(true);
    s = debug.setDepth(s, 12);
    s = debug.setScore(s, 999);
    s = debug.setTitleIndex(s, 1);
    step(s, 30);
    expect(debug.reset(s)).toEqual(fresh(true));
    expect(debug.snapshot(s).predators).toHaveLength(6);
  });
  it("accepts disconnected fixtures and leaves plankton, fog, and bodies alone", () => {
    const s = fresh();
    const rows = Array(C.GRID_ROWS).fill("#".repeat(C.GRID_COLS));
    const n = debug.setMaze(s, rows);
    expect(n.plankton).toEqual(s.plankton);
    expect(n.forager).toEqual(s.forager);
    expect(n.visibility).toEqual(s.visibility);
    expect(n.predators).toEqual(s.predators);
    n.screen = "playing";
    step(n, 120, ["left"]);
    expect(n.forager.x).toBe(s.forager.x);
    expect(n.predators.every((p) => p.state === "den")).toBe(true);
  });
});
describe("movement and progression", () => {
  it("swims at the fixed rate, reverses between centers, and stops when released", () => {
    const s = corridor();
    s.forager.dir = "right";
    s.desired = "right";
    step(s, 15, ["right"]);
    expect(s.forager.x).toBeCloseTo(center(3, 3).x + 16);
    s.desired = "left";
    step(s, 15, ["left"]);
    expect(s.forager.x).toBeCloseTo(center(3, 3).x);
    step(s, 30);
    expect(s.forager.moving).toBe(false);
    expect(s.forager.x).toBeCloseTo(center(3, 3).x);
  });
  it("buffers a perpendicular turn until the junction center", () => {
    const s = fixture({ 2: "#####.", 3: "#.........." }, [3, 3]);
    s.forager.dir = "right";
    s.desired = "right";
    step(s, 45, ["right"]);
    s.desired = "up";
    step(s, 15, ["up"]);
    expect(s.forager.x).toBeCloseTo(center(5, 3).x);
    expect(s.forager.y).toBeCloseTo(center(5, 3).y);
    step(s, 15, ["up"]);
    expect(s.forager.y).toBeCloseTo(center(5, 3).y - 16);
  });
  it("crosses the wrap continuously in one tile of travel", () => {
    const s = fixture({ 3: ".".repeat(C.GRID_COLS) }, [0, 3]);
    s.forager.dir = "left";
    s.desired = "left";
    step(s, 15, ["left"]);
    expect(s.forager.x).toBeCloseTo(C.GRID_ORIGIN_X);
    step(s, 15, ["left"]);
    expect(s.forager.x).toBeCloseTo(center(35, 3).x);
  });
  it("eats, holds brightness, decays on the exact half-life, and clears only by eating", () => {
    let s = corridor();
    s = debug.setPlankton(s, 3, 3, true);
    s = debug.setPlankton(s, 4, 3, true);
    step(s);
    expect(s.score).toBe(C.SCORE_PLANKTON);
    expect(s.brightness).toBe(C.BRIGHT_PER_EAT);
    step(s, C.TICK_HZ);
    expect(s.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    step(s, C.BRIGHT_HALFLIFE * C.TICK_HZ);
    expect(s.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
    s = debug.setForagerTile(s, 4, 3);
    step(s);
    expect(s.screen).toBe("cleared");
    expect(s.score).toBe(2 * C.SCORE_PLANKTON + C.SCORE_CLEAR);
    step(s, 240);
    expect(s.screen).toBe("countdown");
    expect(s.depth).toBe(2);
    expect(s.score).toBe(520);
    const empty = corridor();
    step(empty, 500);
    expect(empty.screen).toBe("playing");
  });
  it("contact spends a reserve life and preserves eaten plankton, score, and memory", () => {
    let s = corridor();
    s = debug.setPlankton(s, 4, 3, true);
    s = debug.addPredator(s, "lanternjaw", 3, 3);
    s = debug.setPredatorMind(s, 0, false);
    s = debug.setScore(s, 400);
    step(s);
    expect(s.lives).toBe(2);
    expect(s.screen).toBe("countdown");
    expect(s.planktonRemaining).toBe(1);
    expect(s.score).toBe(400);
    expect(s.predators.every((p) => !p.released)).toBe(true);
    let n = corridor();
    n = debug.setLives(n, 0);
    n = debug.addPredator(n, "flarefish", 3, 3);
    n = debug.setPredatorMind(n, 0, false);
    step(n);
    expect(n.screen).toBe("gameover");
    expect(n.lives).toBe(0);
  });
  it("admits drifters on cadence, scores them, and supports independent mind and travel switches", () => {
    let s = fresh();
    s = debug.clearPredators(s);
    s = debug.setScreen(s, "playing");
    s = debug.setDrifterIn(s, 0);
    step(s);
    expect(s.drifters).toHaveLength(1);
    expect(s.drifterIn).toBe(C.DRIFTER_INTERVAL);
    s = debug.spawnDrifter(s, 17, 15);
    s = debug.setDrifterMind(s, 1, false);
    step(s);
    expect(s.score).toBe(C.SCORE_PLANKTON + C.SCORE_DRIFTER);
    expect(s.drifters).toHaveLength(1);
  });
});
describe("light, sonar, ink, and predator senses", () => {
  it("lights the wall it lands on but never the corridor behind it", () => {
    const s = fixture({ 3: "#...#...." }, [2, 3]);
    step(s);
    expect(s.visibility[3][4]).toBe("l");
    expect(s.visibility[3][5]).toBe("u");
    expect(lineClear(s, s.forager, center(5, 3))).toBe(false);
    expect(s.visibility[3][3]).toBe("l");
    s.forager = { ...center(7, 3), dir: "left", moving: false };
    step(s);
    expect(s.visibility[3][2]).toBe("r");
  });
  it("floods around bends in path order and leaves distant terrain remembered outside the circle", () => {
    const s = fixture(
      { 3: "#.......", 4: "#######.", 5: "#######....." },
      [1, 3],
    );
    tick(s, { ...still, sonar: true });
    expect(s.pulses[0].front).toBeCloseTo(C.SONAR_WAVE_SPEED * C.TICK_DT);
    expect(s.visibility[5][7]).toBe("u");
    step(s, 70);
    expect(s.visibility[5][7]).not.toBe("u");
    expect(s.sonar.cooldown).toBeGreaterThan(0);
  });
  it("sonar marks sound and flare hunters but leaves the amber disguise unresolved", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 1, 3);
    s = debug.addPredator(s, "gloamfin", 7, 3);
    s = debug.addPredator(s, "lanternjaw", 7, 3);
    s = debug.setPredatorMind(s, 0, false);
    s = debug.setPredatorMind(s, 1, false);
    tick(s, { ...still, sonar: true });
    step(s, 55);
    expect(s.predators[0].lit).toBe(true);
    expect(s.predators[1].lit).toBe(false);
    expect(s.predators[0].mark).toBeGreaterThan(0);
  });
  it("light hunters acquire through sight, lose instantly in ink, and cannot see through rock", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 1, 3);
    s = debug.addPredator(s, "lanternjaw", 4, 3);
    s = debug.setPredatorTravel(s, 0, false);
    step(s);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(s.predators[0].alert).toBe(false);
    tick(s, { ...still, ink: true });
    expect(s.predators[0].state).toBe("wander");
    expect(s.predators[0].speed).toBe(C.DRIFTER_SPEED);
    let n = fixture({ 3: "#..#...." }, [1, 3]);
    n = debug.addPredator(n, "flarefish", 4, 3);
    n = debug.setPredatorTravel(n, 0, false);
    step(n);
    expect(n.predators[0].state).toBe("wander");
  });
  it("close hearing ignores rock and ink and alerts on acquisition", () => {
    let s = fixture({ 3: "#..#...." }, [2, 3]);
    s = debug.addPredator(s, "gloamfin", 4, 3);
    s = debug.setPredatorTravel(s, 0, false);
    tick(s, { ...still, ink: true });
    expect(s.predators[0].hearingLock).toBe(true);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].alert).toBe(true);
    expect(s.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("pathfinds around rock and keeps a travel-disabled mind sensing", () => {
    let s = fixture({ 3: "#......", 4: "#.####.", 5: "#......" }, [1, 5]);
    s = debug.addPredator(s, "gloamfin", 6, 3);
    s = debug.setPredatorState(s, 0, "chase");
    step(s, 80);
    expect(tile(s, s.predators[0].tx, s.predators[0].ty)).toBe(".");
    expect(s.predators[0].ty).toBe(5);
    const p = s.predators[0];
    expect(p.x).toBeLessThan(center(6, 5).x);
    expect(p.y).toBeCloseTo(center(6, 5).y);
  });
  it("a lost sound fix searches, fires one orange ping, and gives up", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 9, 3);
    s = debug.addPredator(s, "gloamfin", 4, 3);
    s = debug.setPredatorState(s, 0, "chase");
    s = debug.setForagerTile(s, 18, 3);
    step(s, 200);
    expect(s.predators[0].state).toBe("search");
    step(s, 150);
    expect(s.predators[0].searchPing).toBe(true);
    expect(s.pulses.some((p) => p.tint === "orange")).toBe(true);
    step(s, 650);
    expect(s.predators[0].state).not.toBe("search");
  });
  it("a flare charges, blooms through rock, then fades without lighting", () => {
    let s = fixture({ 3: "#..#.........." }, [1, 3]);
    s = debug.addPredator(s, "flarefish", 10, 3);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, 840);
    expect(s.predators[0].flareCharging).toBe(true);
    step(s, 60);
    expect(s.predators[0].flaring).toBe(true);
    expect(s.predators[0].flareRadius).toBe(C.FLARE_RADIUS);
    expect(s.visibility[3][6]).toBe("l");
    step(s, 120);
    expect(s.predators[0].flaring).toBe(false);
    expect(s.predators[0].flareRadius).toBe(0);
    expect(s.visibility[3][6]).toBe("r");
  });
  it("staggered releases run only during live play", () => {
    let s = fresh();
    s = debug.setScreen(s, "countdown");
    step(s, 239);
    expect(s.predators.every((p) => !p.released)).toBe(true);
    step(s, 2);
    expect(s.predators[0].released).toBe(true);
    expect(s.predators[1].released).toBe(false);
    s = debug.setScreen(s, "paused");
    const before = copy(s);
    step(s, 800);
    expect(s.playTime).toBe(before.playTime);
    expect(s.predators).toEqual(before.predators);
    expect(s.simTime).toBeGreaterThan(before.simTime);
  });
});
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(new Uint8Array(await readFile(url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(new Uint8Array(await blob.arrayBuffer())),
  );
});
afterAll(() => vi.unstubAllGlobals());
async function harness(ms = 1000 / 60) {
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H),
    events = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game: createGame(),
    clock: new ConstantClock(ms),
    background: "#02090e",
    layout: C.LAYOUT,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  await engine.initialize();
  const key = (code: string, type = "keydown") =>
    events.dispatchEvent(
      Object.assign(new Event(type), { code, repeat: false }),
    );
  return { engine, key, events, canvas };
}
describe("engine integration", () => {
  it("loads seeded art, reports current diagnostics, and runs every screen through registered actions", async () => {
    const { engine, key } = await harness();
    expect(engine.state.screen).toBe("title");
    key("ArrowDown");
    await engine.advance(1);
    key("ArrowDown", "keyup");
    key("Enter");
    await engine.advance(1);
    key("Enter", "keyup");
    expect(engine.state.screen).toBe("howto");
    key("Escape");
    await engine.advance(1);
    key("Escape", "keyup");
    expect(engine.state.menuIndex).toBe(1);
    key("ArrowUp");
    await engine.advance(1);
    key("ArrowUp", "keyup");
    key("Enter");
    await engine.advance(1);
    key("Enter", "keyup");
    expect(engine.state.screen).toBe("countdown");
    await engine.advance(120);
    expect(engine.state.screen).toBe("playing");
    key("Escape");
    await engine.advance(1);
    key("Escape", "keyup");
    expect(engine.state.screen).toBe("paused");
    const f = engine.state.forager;
    await engine.advance(10);
    expect(engine.state.forager).toEqual(f);
    key("Escape");
    await engine.advance(1);
    key("Escape", "keyup");
    expect(engine.state.screen).toBe("playing");
    key("KeyM");
    await engine.advance(1);
    expect(engine.state.muted).toBe(true);
    expect(engine.diagnostics().every((d) => d.error === undefined)).toBe(true);
    expect(engine.diagnostics()[0].value).toContain("playing");
    engine.destroy();
  });
  it("gives identical fixed-step outcomes for different frame partitions and leaves prior states untouched", async () => {
    const a = await harness(1000 / 30),
      b = await harness(1000 / 120);
    for (const h of [a, b]) {
      h.engine.apply((s) =>
        debug.clearPredators(debug.setScreen(s, "playing")),
      );
      h.key("ArrowLeft");
    }
    const prior = debug.snapshot(a.engine.state);
    await a.engine.advance(30);
    await b.engine.advance(120);
    expect(debug.snapshot(a.engine.state)).toEqual(
      debug.snapshot(b.engine.state),
    );
    expect(prior.simTime).toBe(0);
    expect(a.engine.state.forager.x).toBeCloseTo(
      center(17, 15).x - C.FORAGER_SPEED,
    );
    a.engine.destroy();
    b.engine.destroy();
  });
  it("requires pointer press and release in the same item and returns from how-to with touch", async () => {
    const { engine, events } = await harness();
    const pointer = (type: string, x: number, y: number) =>
      events.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    pointer("pointerdown", 640, 430);
    await engine.advance(1);
    pointer("pointerup", 640, 490);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
    pointer("pointerdown", 640, 490);
    pointer("pointerup", 640, 490);
    await engine.advance(1);
    expect(engine.state.screen).toBe("howto");
    pointer("pointerdown", 150, 180);
    pointer("pointerup", 150, 180);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
    expect(engine.state.menuIndex).toBe(1);
    engine.destroy();
  });
});

describe("sensing timing and debug edge cases", () => {
  it("expires a sonar mark even when the marked predator mind is frozen", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 1, 3);
    s = debug.addPredator(s, "gloamfin", 7, 3);
    s = debug.setPredatorMind(s, 0, false);
    tick(s, { ...still, sonar: true });
    step(s, 55);
    expect(s.predators[0].lit).toBe(true);
    step(s, C.SONAR_MARK_TIME * C.TICK_HZ);
    expect(s.predators[0].lit).toBe(false);
    expect(s.predators[0].mark).toBe(0);
  });
  it("a Gloamfin ping does not reveal ground and acquires only when its front arrives", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 1, 3);
    s = debug.addPredator(s, "gloamfin", 8, 3);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, C.GLOAMFIN_PING_INTERVAL * C.TICK_HZ);
    expect(s.pulses[0].tint).toBe("violet");
    expect(s.predators[0].state).toBe("wander");
    expect(s.visibility[3][8]).toBe("u");
    step(s, 62);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].fix).toEqual({ tx: 1, ty: 3 });
    expect(s.predators[0].alert).toBe(true);
    expect(s.visibility[3][8]).toBe("u");
  });
  it("a lapsed light fix lasts exactly the linger window while ink drops it immediately", () => {
    let s = corridor();
    s = debug.setForagerTile(s, 1, 3);
    s = debug.addPredator(s, "lanternjaw", 4, 3);
    s = debug.setPredatorTravel(s, 0, false);
    step(s);
    s = debug.setForagerTile(s, 18, 3);
    step(s, C.LINGER_TIME * C.TICK_HZ - 1);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].fix).toEqual({ tx: 1, ty: 3 });
    step(s);
    expect(s.predators[0].state).toBe("wander");
  });
  it("a bloom takes a lock through rock and ends its own light at once", () => {
    let s = fixture({ 3: "#..#..........." }, [2, 3]);
    s = debug.addPredator(s, "flarefish", 7, 3);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, (C.FLARE_INTERVAL + C.FLARE_CHARGE) * C.TICK_HZ);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].flaring).toBe(false);
    expect(s.predators[0].flareRadius).toBe(0);
    expect(s.predators[0].alert).toBe(true);
    expect(s.predators[0].fix).toEqual({ tx: 2, ty: 3 });
  });
  it("drops a Gloamfin to the corner speed and ramps back in two seconds", () => {
    let s = fixture(
      { 3: "#..................", 4: "######.", 5: "######." },
      [18, 3],
    );
    s = debug.addPredator(s, "gloamfin", 6, 5);
    s = debug.setPredatorState(s, 0, "chase");
    step(s, 70);
    expect(s.predators[0].dir).toBe("right");
    expect(s.predators[0].speed).toBeGreaterThanOrEqual(
      C.GLOAMFIN_CORNER_SPEED,
    );
    expect(s.predators[0].speed).toBeLessThan(C.GLOAMFIN_CHASE_SPEED);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, C.GLOAMFIN_RAMP_TIME * C.TICK_HZ);
    expect(s.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("releases the second hunter exactly five live seconds after the first", () => {
    let s = fresh();
    s = debug.setScreen(s, "playing");
    step(s, C.DEN_RELEASE_GAP * C.TICK_HZ - 1);
    expect(s.predators[0].released).toBe(true);
    expect(s.predators[1].released).toBe(false);
    step(s);
    expect(s.predators[1].released).toBe(true);
  });
  it("permits extra drifters and hunters, but freezes each disabled mind independently", () => {
    let s = corridor();
    s = debug.spawnDrifter(s, 9, 3);
    s = debug.spawnDrifter(s, 10, 3);
    s = debug.spawnDrifter(s, 11, 3);
    s = debug.setDrifterMind(s, 0, false);
    s = debug.setDrifterTravel(s, 1, false);
    s = debug.setDrifterIn(s, C.DRIFTER_INTERVAL);
    s = debug.addPredator(s, "flarefish", 15, 3);
    s = debug.setPredatorDir(s, 0, "left");
    s = debug.setPredatorReleased(s, 0, false);
    s = debug.setPredatorMind(s, 0, false);
    step(s, 50);
    expect(s.drifters).toHaveLength(3);
    expect(s.drifters[0].x).toBe(center(9, 3).x);
    expect(s.drifters[1].x).toBe(center(10, 3).x);
    expect(s.predators[0].x).toBe(center(15, 3).x);
    expect(s.predators[0].dir).toBe("left");
    expect(debug.clearDrifters(s).drifters).toHaveLength(0);
    expect(() => debug.setDrifterTravel(s, 6, true)).toThrow();
    expect(() => debug.setPredatorState(s, 0, "den")).toThrow();
  });
  it("raises each cue at most once on a tick and preserves arbitrary posed cooldowns", () => {
    let s = corridor();
    s = debug.setPlankton(s, 3, 3, true);
    const cues = tick(s, { ...still, sonar: true, ink: true });
    expect([...cues].sort()).toEqual(
      [C.CUES.eat, C.CUES.descend, C.CUES.sonar, C.CUES.ink].sort(),
    );
    s = debug.setScreen(s, "playing");
    s = debug.setSonarCooldown(s, 30);
    s = debug.setInkCooldown(s, 40);
    step(s, C.TICK_HZ);
    expect(s.sonar.cooldown).toBeCloseTo(29);
    expect(s.ink.cooldown).toBeCloseTo(39);
    expect(() => debug.setBrightHold(s, 2)).toThrow();
  });
});
