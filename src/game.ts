import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { copy, derive, DIRS, enter, fresh, items, resetRun } from "./model";
import type { FathomState, ReadState } from "./model";
import { debug, menuRect } from "./debug";
import type { FathomDebugApi } from "./debug";
import { tick } from "./simulation";
import { render, type Art } from "./render";
export { BACKGROUND } from "./render";
export type {
  FathomState,
  Forager,
  Predator,
  Drifter,
  Pulse,
  InkCloud,
  Body,
  Direction,
  Screen,
  PredatorKind,
} from "./model";
export type { FathomDebugApi } from "./debug";
function confirm(s: FathomState): FathomState {
  const i = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = i ?? 0;
    if (i === 1) enter(s, "howto");
    else s = resetRun(s, "countdown");
  } else if (s.screen === "paused") {
    if (i === 0) enter(s, "playing");
    else s = resetRun(s, i === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    s = resetRun(s, i === 0 ? "countdown" : "title");
  return s;
}
function input(s: FathomState, api: UpdateApi): FathomState {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const screen = s.screen;
  if (screen === "playing") {
    if (api.input.pressed("pause")) {
      enter(s, "paused");
      return s;
    }
    for (const d of DIRS) if (api.input.pressed(d)) s.desired = d;
    s.pendingSonar ||= api.input.pressed("a");
    s.pendingInk ||= api.input.pressed("b");
    return s;
  }
  if (
    screen === "paused" &&
    (api.input.pressed("pause") || api.input.pressed("back"))
  ) {
    enter(s, "playing");
    return s;
  }
  if (
    screen === "howto" &&
    (api.input.pressed("confirm") || api.input.pressed("back"))
  )
    return resetRun(s, "title");
  if (screen === "gameover" && api.input.pressed("back"))
    return resetRun(s, "title");
  const menu = items(screen);
  let clicked = false;
  for (const p of api.input.pointerSamples()) {
    if (!p.primary || (p.button !== null && p.button !== "primary")) continue;
    const index = menu.findIndex((_, i) => {
      const r = menuRect(s, i)!;
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (index >= 0) s.menuIndex = index;
    if (p.type === "down")
      s.pointerStarts[p.id] = { screen, index: index >= 0 ? index : null };
    if (p.type === "up") {
      const start = s.pointerStarts[p.id];
      delete s.pointerStarts[p.id];
      if (
        start?.screen === screen &&
        (screen === "howto" || (index >= 0 && start.index === index))
      )
        clicked = true;
    }
  }
  if (screen === "howto" && clicked) return resetRun(s, "title");
  if (menu.length) {
    if (api.input.pressed("up"))
      s.menuIndex = ((s.menuIndex ?? 0) - 1 + menu.length) % menu.length;
    if (api.input.pressed("down"))
      s.menuIndex = ((s.menuIndex ?? 0) + 1) % menu.length;
    if (api.input.pressed("confirm") || clicked) s = confirm(s);
  }
  return s;
}
/** Each engine instance owns immutable loaded art; all evolving data belongs to its state. */
export function createGame(): Game<FathomState, FathomDebugApi> {
  const art: Art = {};
  return {
    async initialize(api) {
      for (const name of C.ACTIONS)
        api.input.register(name, { keys: [...C.BINDINGS[name]] });
      const sounds = [
        [C.CUES.eat, 740, 1050, 55],
        [C.CUES.sonar, 900, 110, 360],
        [C.CUES.ink, 110, 45, 220],
        [C.CUES.predatorPing, 360, 750, 230],
        [C.CUES.flare, 160, 1100, 310],
        [C.CUES.caught, 220, 35, 480],
        [C.CUES.descend, 330, 880, 550],
      ] as const;
      for (const [cue, freq, freqTo, durationMs] of sounds)
        api.audio.define(cue, {
          freq,
          freqTo,
          durationMs,
          gain: 0.12,
          wave: cue === C.CUES.ink ? "triangle" : "sine",
        });
      const sheets: Record<string, number> = {
        glimmerfin: 8,
        lanternjaw: 16,
        gloamfin: 8,
        flarefish: 8,
        drifter: 8,
        "flare-bloom": 8,
        "trench-walls": 19,
      };
      await Promise.all(
        Object.entries(sheets).map(async ([name, count]) => {
          art[name] = await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          );
        }),
      );
      api.diagnostics.register(
        "Dive",
        (s) =>
          `${s.screen} / depth ${s.depth} / score ${s.score} / lives ${s.lives}`,
      );
      api.diagnostics.register(
        "Light",
        (s) =>
          `G ${s.brightness.toFixed(2)} / V ${s.visionRadius.toFixed(1)} / R ${s.windowRadius.toFixed(1)}`,
      );
      api.diagnostics.register(
        "Resources",
        (s) =>
          `sonar ${s.sonar.cooldown.toFixed(2)} / ink ${s.ink.cooldown.toFixed(2)} / motes ${s.planktonRemaining}`,
      );
      api.diagnostics.register(
        "Forager",
        (s) => `${s.forager.tx},${s.forager.ty} / ${s.forager.dir}`,
      );
      for (let i = 0; i < C.DEN_ORDER.length * C.ROSTER_CAP; i++)
        api.diagnostics.register(`Predator ${i + 1}`, (s) => {
          const p = s.predators[i];
          return p
            ? `${p.kind} ${p.state} / ${p.tx},${p.ty} / ${p.speed.toFixed(1)} / alert ${p.alert}`
            : "—";
        });
      return [fresh(), debug];
    },
    update(state: ReadState, api, dt) {
      const s = input(copy(state), api);
      s.remainder += dt;
      const held = DIRS.filter((d) => api.input.value(d) > 0);
      while (s.remainder + 1e-10 >= C.TICK_DT) {
        const cues = tick(s, {
          held,
          sonar: s.pendingSonar,
          ink: s.pendingInk,
        });
        s.pendingSonar = false;
        s.pendingInk = false;
        s.remainder = Math.max(0, s.remainder - C.TICK_DT);
        for (const cue of cues) api.audio.play(cue);
      }
      return derive(s);
    },
    render(s, api) {
      render(s, api.ctx, art);
    },
  };
}
export const game = createGame();
