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
| New ball | R | X |
| Tuning panel | ` | — |

Current mode is a receiving drill: the ball is fed off the net toward you.
Get under it, time your hit at chest height (jump for high balls), and
return it onto the net. The orange ring shows where the ball will land.

## Deploy

`npm run build` produces a static site in `dist/`. Host it on Cloudflare Pages,
Netlify, Vercel (build command `npm run build`, output `dist`), or zip `dist/`
and upload it to itch.io as an HTML5 game.
