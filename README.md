# Fathom

**Hunt in the dark.** Fathom is a bioluminescent deep-sea maze chase. Graze every plankton mote to descend, use sonar to read the corridors, and escape three predators that hunt by light, sound, and sudden flare.

This is the **Kindle** dive. Your outer vision circle expands as you eat. Explored terrain stays remembered, but beyond the circle even that memory disappears into darkness. Feeding lets you see farther—and makes you easier to find.

## Run locally

Use a current Node.js release compatible with Vite 8 (Node 22.12+).

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Everything runs in the browser; no account, service, or network asset is required.

## Production

```sh
npm run build
npm run preview
```

The complete static site is in `dist/`, with `index.html` at its root. Serve that directory as-is at a host's root or under a sub-path. Art URLs are relative to the page.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held; up/down select menu items |
| Space | Sonar during play; confirm a menu item |
| Shift | Release ink |
| Enter | Confirm |
| Escape / P | Pause or resume |
| Escape | Return from help or game over |
| M | Toggle sound on any screen |
| Click / tap | Select and confirm a menu item |
| Backtick | Engine diagnostics overlay |

Touch devices also receive the engine's directional pad, sonar, and ink buttons. A dive starts with three reserve lives in addition to the current attempt. Ink blinds the light hunters; the eyeless Gloamfin still hears through it. An amber glimmer may be a harmless drifter or a disguised Lanternjaw.

## Verification

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests exercise the fixed-step simulation and the Simple 2D engine with a real canvas, scripted clocks, registered keyboard actions, and touch events. The engine exposes the read-only state and required debug poses through its own handle; the game installs no global debug object.

Captured play, screenshots, and the player-facing description are in [showcase/](showcase/showcase.md).
