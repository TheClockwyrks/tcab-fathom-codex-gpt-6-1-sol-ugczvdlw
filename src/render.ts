import * as C from "./constants";
import { center, DIRS, items, neighbor, tile } from "./model";
import type { Direction, ReadState } from "./model";
import { menuRect } from "./debug";
import { distance, flooded } from "./simulation";
export type Art = Record<string, ImageBitmap[]>;
export const BACKGROUND = "#03060c";
const CYAN = "#80f5ed",
  DIM = "#54787e",
  WHITE = "#d7eee9",
  AMBER = "#ff8059";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size = 18,
  color = WHITE,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#18333b",
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  disc(ctx, x, y, r);
  ctx.fill();
}
function sprite(
  ctx: CanvasRenderingContext2D,
  art: Art,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
) {
  const img = art[sheet]?.[frame];
  if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function terrain(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  art: Art,
  all = false,
) {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const v = all ? "r" : s.visibility[y][x];
      if (v === "u") continue;
      const t = tile(s, x, y);
      let frame = 16;
      if (t === "#") {
        frame = 0;
        if (tile(s, x, y - 1) === "#") frame += 1;
        if (tile(s, x + 1, y) === "#") frame += 2;
        if (tile(s, x, y + 1) === "#") frame += 4;
        if (tile(s, x - 1, y) === "#") frame += 8;
      }
      if (t === "g") frame = 18;
      const c = center(x, y);
      ctx.globalAlpha = v === "l" ? 1 : 0.27;
      sprite(ctx, art, "trench-walls", frame, c.x, c.y);
      if (s.plankton[y][x] === "*") {
        ctx.fillStyle = CYAN;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = v === "l" ? 8 : 0;
        disc(ctx, c.x, c.y, C.PLANKTON_DOT / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function amber(ctx: CanvasRenderingContext2D, x: number, y: number) {
  glow(ctx, x, y, 19, "#f46b354a");
  ctx.fillStyle = AMBER;
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 9;
  disc(ctx, x, y, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
}
function mazeView(ctx: CanvasRenderingContext2D, s: ReadState, art: Art) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.drawImage(
    art["trench-walls"][17],
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.save();
  disc(ctx, s.forager.x, s.forager.y, s.windowRadius);
  ctx.clip();
  terrain(ctx, s, art);
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#35cccd14");
  for (const d of s.drifters) amber(ctx, d.x, d.y);
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") amber(ctx, p.x, p.y);
  ctx.restore();
  // A bloom lights and draws its terrain over the outer-circle blackout.
  for (const p of s.predators)
    if (p.flaring) {
      ctx.save();
      disc(ctx, p.x, p.y, C.FLARE_RADIUS);
      ctx.clip();
      terrain(ctx, s, art);
      ctx.restore();
    }
  for (const cloud of s.inkClouds) {
    ctx.globalAlpha = Math.min(1, cloud.remaining / 0.4);
    glow(ctx, cloud.x, cloud.y, cloud.radius, "#000309f5");
    ctx.globalAlpha = 1;
  }
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, art, "drifter", Math.floor(s.playTime * 8) % 8, d.x, d.y);
  for (const p of s.predators) {
    if (p.lit) {
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (p.mind && p.travel ? Math.floor(s.playTime * 8) % 8 : 0)
          : facing[p.dir] +
            (p.mind && p.travel ? Math.floor(s.playTime * 7) % 2 : 0);
      const fullyLit =
        s.visibility[p.ty]?.[p.tx] === "l" ||
        p.alert ||
        s.predators.some((f) => f.flaring && distance(f, p) <= C.FLARE_RADIUS);
      ctx.globalAlpha =
        p.mark > 0 && !fullyLit ? p.mark / C.SONAR_MARK_TIME : 1;
      sprite(ctx, art, p.kind, frame, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#b58bff" : AMBER;
      const progress = 1 - p.alertLeft / C.ALERT_TIME;
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      disc(ctx, p.x, p.y, 14 + progress * 24);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * 20,
          p.y + Math.sin(a) * 20,
          p.x + Math.cos(a) * (27 + progress * 15),
          p.y + Math.sin(a) * (27 + progress * 15),
          color,
        );
      }
      ctx.globalAlpha = 1;
    }
    if (p.flareCharging || p.flaring || p.fade > 0) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((1 - p.flareLeft / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 + Math.min(2, Math.floor((1 - p.flareLeft / C.FLARE_BLOOM) * 3))
          : 6 + (p.fade < 0.17 ? 1 : 0);
      sprite(ctx, art, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
    }
  }
  for (const pulse of s.pulses) {
    const map = flooded(s, pulse.ox, pulse.oy);
    const color =
      pulse.tint === "cyan"
        ? CYAN
        : pulse.tint === "violet"
          ? "#b78eff"
          : "#ff995c";
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    // Each crest slides along a shortest corridor edge. Branches split it;
    // rock blocks it, and the wrap edge carries it across the two mouths.
    for (const [key, d] of map) {
      if (d > pulse.range || Math.abs(d - pulse.front) > 1) continue;
      const tx = key % C.GRID_COLS,
        ty = Math.floor(key / C.GRID_COLS);
      const c = center(tx, ty);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = Math.max(0, 1 - Math.abs(d - pulse.front) * 3);
      disc(ctx, c.x, c.y, 8);
      ctx.stroke();
      if (pulse.front < d || pulse.front > d + 1) continue;
      const progress = pulse.front - d;
      ctx.globalAlpha = 0.85;
      for (const dir of DIRS) {
        const n = neighbor(s, tx, ty, dir);
        if (map.get(n.ty * C.GRID_COLS + n.tx) !== d + 1 || d + 1 > pulse.range)
          continue;
        const end = center(n.tx, n.ty);
        let dx = end.x - c.x;
        const dy = end.y - c.y;
        if (Math.abs(dx) > C.TILE) dx = -Math.sign(dx) * C.TILE;
        const x = c.x + dx * progress,
          y = c.y + dy * progress;
        ctx.beginPath();
        ctx.moveTo(x - (dy ? 10 : 0), y - (dx ? 10 : 0));
        ctx.lineTo(x + (dy ? 10 : 0), y + (dx ? 10 : 0));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  glow(ctx, s.forager.x, s.forager.y, 34, "#75f5e64a");
  sprite(
    ctx,
    art,
    "glimmerfin",
    facing[s.forager.dir] +
      (s.forager.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  // Amber glimmers keep their exact center and their identical styling over a revealed body.
  for (const p of s.predators)
    if (
      p.kind === "lanternjaw" &&
      p.state !== "den" &&
      distance(p, s.forager) <= s.windowRadius
    )
      amber(ctx, p.x, p.y);
  for (const d of s.drifters)
    if (distance(d, s.forager) <= s.windowRadius) amber(ctx, d.x, d.y);
  ctx.restore();
  line(ctx, 64, 79, 1216, 79);
  line(ctx, 64, 657, 1216, 657);
}
function gauge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  amount: number,
  color: string,
) {
  text(ctx, label, x, 680, 12, DIM);
  ctx.fillStyle = "#153038";
  ctx.fillRect(x, 692, 145, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x, 692, 145 * Math.max(0, Math.min(1, amount)), 4);
}
function hud(ctx: CanvasRenderingContext2D, s: ReadState, art: Art) {
  text(ctx, "SCORE", 64, 24, 11, DIM);
  text(ctx, String(s.score).padStart(6, "0"), 62, 68, 48, WHITE);
  text(ctx, C.TITLE_TEXT, 640, 35, 22, CYAN, "center");
  text(ctx, C.DIVE_LABEL, 640, 58, 11, DIM, "center");
  text(ctx, `${s.planktonRemaining} MOTES REMAIN`, 1216, 36, 14, DIM, "right");
  text(
    ctx,
    s.muted ? "SOUND OFF  /  M" : "SOUND ON  /  M",
    1216,
    58,
    11,
    DIM,
    "right",
  );
  text(ctx, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 691, 18, CYAN);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, art, "glimmerfin", 6, 235 + i * 29, 686, 24);
  gauge(
    ctx,
    "SPACE / SONAR",
    470,
    1 - s.sonar.cooldown / C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    "SHIFT / INK",
    680,
    1 - s.ink.cooldown / C.INK_COOLDOWN,
    "#a7a0df",
  );
  text(ctx, "WASD / ARROWS     P / PAUSE", 1216, 688, 12, DIM, "right");
}
function menu(ctx: CanvasRenderingContext2D, s: ReadState) {
  for (const [i, label] of items(s.screen).entries()) {
    const r = menuRect(s, i)!;
    const selected = i === s.menuIndex;
    ctx.fillStyle = selected ? "#102d32" : "#07151c";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#64d4cb" : "#193039";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text(ctx, "›", r.x + 20, r.y + 31, 24, CYAN);
    }
    text(
      ctx,
      label,
      r.x + r.w / 2,
      r.y + 30,
      18,
      selected ? CYAN : DIM,
      "center",
    );
    text(
      ctx,
      String(i + 1).padStart(2, "0"),
      r.x + r.w - 19,
      r.y + 29,
      10,
      DIM,
      "right",
    );
  }
}
function atmosphere(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, C.STAGE_H);
  g.addColorStop(0, "#0b1f2b");
  g.addColorStop(0.55, BACKGROUND);
  g.addColorStop(1, "#041018");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  glow(ctx, 640, 290, 380, "#12404745");
  for (let i = 0; i < 100; i++) {
    const x = (i * 397 + 47) % C.STAGE_W,
      y = (i * 173 + 29) % C.STAGE_H;
    ctx.fillStyle = i % 3 ? "#335b6539" : "#75bcbf55";
    ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);
  }
  for (const x of [85, 1195]) {
    line(ctx, x, 110, x, 620, "#19333c");
    for (let y = 120; y < 620; y += 20)
      line(ctx, x, y, x + (x < 640 ? 5 : -5), y, "#24414a");
  }
  text(ctx, "ABYSSAL FIELD NOTES", 112, 119, 11, DIM);
  text(ctx, "01 / KINDLE", 1168, 119, 11, DIM, "right");
  line(ctx, 112, 137, 1168, 137);
  line(ctx, 112, 620, 1168, 620);
  text(ctx, "A LIGHT IS A LURE.", 112, 647, 11, DIM);
  text(ctx, "THE DEEP IS LISTENING.", 1168, 647, 11, DIM, "right");
}
function title(ctx: CanvasRenderingContext2D, s: ReadState, art: Art) {
  atmosphere(ctx);
  text(ctx, "↓  DESCEND INTO THE UNKNOWN  ↓", 640, 190, 12, DIM, "center");
  ctx.shadowColor = "#54d9d052";
  ctx.shadowBlur = 25;
  text(ctx, C.TITLE_TEXT, 640, 298, 112, WHITE, "center");
  ctx.shadowBlur = 0;
  text(ctx, C.TAGLINE_TEXT.split("").join(" "), 640, 336, 17, CYAN, "center");
  glow(ctx, 640, 373, 42, "#5bf2e837");
  sprite(ctx, art, "glimmerfin", 6, 640, 373);
  menu(ctx, s);
  text(
    ctx,
    "↑ ↓ SELECT     ENTER DIVE     M SOUND",
    640,
    567,
    12,
    DIM,
    "center",
  );
}
function howto(ctx: CanvasRenderingContext2D, art: Art) {
  atmosphere(ctx);
  text(ctx, "SURVIVING THE DEEP", 640, 204, 38, WHITE, "center");
  text(
    ctx,
    "Feed your light. Mind what it attracts.",
    640,
    238,
    15,
    CYAN,
    "center",
  );
  const entries = [
    [
      "lanternjaw",
      "LANTERNJAW / LIGHT",
      "An amber lure. Your glow gives you away.",
    ],
    [
      "gloamfin",
      "GLOAMFIN / SOUND",
      "Eyeless. Your sonar can bring it closer.",
    ],
    [
      "flarefish",
      "FLAREFISH / FLASH",
      "A warm bloom sees straight through rock.",
    ],
  ];
  entries.forEach(([sheet, name, desc], i) => {
    const y = 302 + i * 68;
    sprite(ctx, art, sheet, 0, 240, y, 44);
    text(ctx, name, 285, y - 5, 16, CYAN);
    text(ctx, desc, 285, y + 19, 14, DIM);
  });
  text(
    ctx,
    "WASD / ARROWS   Swim through the maze",
    825,
    294,
    14,
    WHITE,
    "center",
  );
  text(
    ctx,
    "SPACE           Send a sonar pulse",
    825,
    328,
    14,
    WHITE,
    "center",
  );
  text(
    ctx,
    "SHIFT           Drop ink to blind light hunters",
    825,
    362,
    12,
    WHITE,
    "center",
  );
  text(ctx, "ESC / P  Pause    M  Mute", 825, 400, 14, DIM, "center");
  text(
    ctx,
    "Eat every mote to descend. Your light reveals; sonar remembers.",
    640,
    513,
    14,
    WHITE,
    "center",
  );
  text(
    ctx,
    "The circle grows as you feed. Beyond it, even memory goes dark.",
    640,
    542,
    14,
    DIM,
    "center",
  );
  text(ctx, "ENTER / ESC / TAP TO RETURN", 640, 587, 13, CYAN, "center");
}
export function render(s: ReadState, ctx: CanvasRenderingContext2D, art: Art) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") title(ctx, s, art);
  else if (s.screen === "howto") howto(ctx, art);
  else if (s.screen === "gameover") {
    atmosphere(ctx);
    text(ctx, "THE DEEP TAKES ITS DUE", 640, 230, 32, WHITE, "center");
    text(ctx, "DIVE LOST", 640, 287, 16, AMBER, "center");
    text(
      ctx,
      `${String(s.score).padStart(6, "0")}  /  DEPTH ${s.depth}`,
      640,
      353,
      30,
      CYAN,
      "center",
    );
    menu(ctx, s);
  } else {
    mazeView(ctx, s, art);
    hud(ctx, s, art);
    if (s.screen !== "playing") {
      if (s.screen === "paused") {
        ctx.fillStyle = "#02090ed9";
        ctx.fillRect(360, 195, 560, 418);
        text(ctx, "SUSPENDED", 640, 289, 38, WHITE, "center");
        text(ctx, "Hold your breath.", 640, 327, 15, DIM, "center");
        menu(ctx, s);
      } else {
        ctx.fillStyle = "#02090ece";
        ctx.fillRect(390, 275, 500, 144);
        text(
          ctx,
          s.screen === "countdown" ? "DIVE" : `DEPTH ${s.depth} CLEARED`,
          640,
          327,
          32,
          CYAN,
          "center",
        );
        text(
          ctx,
          s.screen === "countdown"
            ? String(Math.max(1, Math.ceil(s.screenLeft)))
            : "THE DARK RUNS DEEPER",
          640,
          382,
          s.screen === "countdown" ? 36 : 15,
          WHITE,
          "center",
        );
      }
    }
  }
  ctx.restore();
}
