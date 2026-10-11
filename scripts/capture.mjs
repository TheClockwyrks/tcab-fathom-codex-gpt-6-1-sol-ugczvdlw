import { Buffer } from "node:buffer";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

// Run `npm run dev` first. This separate capture harness uses the public engine
// and game modules, never alters main.ts, and installs nothing in the game.
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.route("http://localhost:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<body style="margin:0"><canvas id="capture" style="width:100vw;height:100vh"></canvas></body>',
    }),
  );
  await page.goto("http://localhost:5173/");
  const result = await page.evaluate(async () => {
    const { createEngine, ConstantClock } =
      await import("/.vendor/engine/@clockwyrks/simple-2d/dist/index.js");
    const { createGame, BACKGROUND } = await import("/src/game.ts");
    const canvas = globalThis.document.getElementById("capture");
    const engine = createEngine({
      canvas,
      width: 1280,
      height: 720,
      game: createGame(),
      background: BACKGROUND,
      layout: "dpad-4-two-buttons",
      clock: new ConstantClock(1000 / 30),
    });
    await engine.initialize();
    await engine.advance(1);
    const title = canvas.toDataURL("image/png");
    const d = engine.debug;
    engine.apply((s) => d.setScreen(d.clearPredators(s), "playing"));
    engine.apply((s) => d.setForagerTile(s, 13, 11));
    engine.apply((s) => d.setForagerDir(s, "right"));
    engine.apply((s) => d.addPredator(s, "lanternjaw", 9, 11));
    engine.apply((s) => d.addPredator(s, "gloamfin", 5, 3));
    engine.apply((s) => d.addPredator(s, "flarefish", 30, 3));
    engine.apply((s) => d.spawnDrifter(s, 24, 11));
    const key = (code, type = "keydown") =>
      globalThis.document.dispatchEvent(
        new globalThis.KeyboardEvent(type, { code, bubbles: true }),
      );
    key("ArrowRight");
    engine.startRecording();
    let kindle;
    for (let frame = 0; frame < 120; frame++) {
      if (frame % 50 === 0) key("Space");
      await engine.advance(1);
      if (frame % 50 === 0) key("Space", "keyup");
      if (frame === 65) kindle = canvas.toDataURL("image/png");
    }
    key("ArrowRight", "keyup");
    const recording = engine.stopRecording();
    const snapshot = d.snapshot(engine.state);
    if (snapshot.screen !== "playing")
      throw new Error("Capture must remain in live play");
    engine.destroy();
    return { title, kindle, recording, snapshot };
  });
  await mkdir("showcase", { recursive: true });
  for (const [file, data] of [
    ["title.png", result.title],
    ["kindle.png", result.kindle],
  ]) {
    await writeFile(
      `showcase/${file}`,
      Buffer.from(data.split(",")[1], "base64"),
    );
  }
  await writeFile(
    "showcase/dive.json.gz",
    gzipSync(JSON.stringify(result.recording)),
  );
  globalThis.console.log(
    `Captured ${result.recording.frames.length} live frames; score ${result.snapshot.score}, screen ${result.snapshot.screen}.`,
  );
} finally {
  await browser.close();
}
