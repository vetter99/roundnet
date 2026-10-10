# Roundnet

A free browser roundnet (Spikeball) game. Arcade physics, 2v2, local play.

## Play locally

Requires Node 22+.

```sh
npm install
npm run dev
```

Open http://localhost:5173.

**Controls**

| Action | Keyboard | Controller |
|---|---|---|
| Move / aim | WASD or arrows | Left stick |
| Pass (pop up) | J | A, LB or LT |
| Spike | K | B, RB or RT |
| Jump | Space | Y |
| New serve / rematch | R | X |
| Tuning panel | ` | — |

Current mode is a 1v1 rally game. When the ball comes off the net it's the
other player's ball: they get up to 3 touches to put it back on the net. Let
it hit the ground and the other side scores. First to 21, win by 2. Hold a
hit button to charge it and release to swing. Player 1 uses the first
controller (or the keyboard); player 2 uses a second controller, the keyboard
once someone presses a key, or otherwise the CPU.

## Deploy

`npm run build` produces a static site in `dist/`. Host it on Cloudflare Pages,
Netlify, Vercel (build command `npm run build`, output `dist`), or zip `dist/`
and upload it to itch.io as an HTML5 game.
