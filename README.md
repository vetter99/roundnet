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
| Serve | J | A |
| Reset a stuck rally | R | X |
| Tuning panel | ` | — |

Current mode is a 1v1 mechanics sandbox (no scoring yet). When the ball comes
off the net it's the other player's ball, and they have to put it back on the
net. After the ball lands, the server presses A (or J) to serve. Hold a hit
button to charge it and release to swing; the rings at the landing spot turn
green at the perfect moment. You play Blue with the first controller (or the
keyboard); Red is always the CPU for now. Click the page once to turn on sound.

## Deploy

`npm run build` produces a static site in `dist/`. Host it on Cloudflare Pages,
Netlify, Vercel (build command `npm run build`, output `dist`), or zip `dist/`
and upload it to itch.io as an HTML5 game.
