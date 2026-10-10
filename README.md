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
| Dive | automatic: swing at a ball just out of reach | |
| Serve | J | A |
| Reset a stuck rally | R | View / Back |
| Tuning panel | ` | — |

**Two players:** click **👥 2 Player** (top right) to have a second person
play Red instead of the CPU. With two controllers, each player uses one; with
one controller, the second player uses the keyboard; with no controllers, the
keyboard is split: Blue uses WASD + J/K/Space, Red uses the arrow keys +
`,` (pass/serve) `.` (spike) `/` (jump).

Current mode is a 1v1 mechanics sandbox (no scoring yet). When the ball comes
off the net it's the other player's ball, and they have to put it back on the
net. After the ball lands, the server presses A (or J) to serve. Hold a hit
button to charge it and release to swing; the rings at the landing spot turn
green at the perfect moment. You play Blue with the first controller (or the
keyboard); Red is the CPU unless you turn on 2 Player. Click the page once to turn on sound.

## Deploy

`npm run build` produces a static site in `dist/`. Host it on Cloudflare Pages,
Netlify, Vercel (build command `npm run build`, output `dist`), or zip `dist/`
and upload it to itch.io as an HTML5 game.

## Credits

Music: "Stage 1" from Chiptune Adventures by Juhani Junkala
(https://opengameart.org/content/4-chiptunes-adventure), released under CC0
(public domain). Credit isn't required, but it's appreciated.
