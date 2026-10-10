# Roundnet

A free-to-play browser roundnet (Spikeball) game: 2v2, arcade physics in the
spirit of Mario volleyball and Disc Jam. Local play only (couch + bots), no
online multiplayer. Skill should decide matches: no randomness, no rubber-banding.

## Commands

- `npm run dev`: dev server with hot reload (http://localhost:5173)
- `npm test`: Vitest unit tests for the sim
- `npm run typecheck`
- `npm run build`: typecheck + production build to `dist/` (static, deployable anywhere)

Requires Node 22 (see `.nvmrc` and `engines` in package.json).

## Architecture rules (keep these)

```
src/config/tuning.ts  every gameplay number; the live `tuning` object
src/sim/              pure game logic: state + fixed-tick step functions
src/render/           Babylon.js; reads sim state, never changes it
src/input/            keyboard/gamepad → Intent
src/debug/            Tweakpane tuning panel (` key)
src/main.ts           wires it together; fixed 60Hz loop with render interpolation
```

1. **`src/sim` is pure.** No Babylon, DOM, `window`, `navigator`, `Math.random`,
   or wall-clock time. `src/sim/purity.test.ts` enforces this. Sim functions take
   `Tuning` as a parameter instead of importing the live `tuning` object.
2. **Fixed timestep.** The sim only advances via `stepWorld` in ticks of `DT`
   (1/60 s). Same inputs must always give the same state (there is a
   determinism test). This enables replays and keeps tuning reproducible.
3. **Players are driven by `Intent`s.** Input devices and (future) bots both
   produce an `Intent`; the sim never knows which device or AI produced it.
4. **No magic numbers in game logic.** Add new tunables to `DEFAULT_TUNING` with
   a comment, and add a slider range in `src/debug/tuningPane.ts`.
5. **Power-ups (phase 4) will be modifiers** that hook into sim events (on hit,
   on net bounce, ball speed). Don't special-case power-ups inside physics code.
6. Renderer imports use deep paths (`@babylonjs/core/Meshes/meshBuilder`), never
   the `@babylonjs/core` root, which bloats the bundle ~5x.

## Game rules implemented so far

- Ball bounces off the net surface (vertical speed scaled by `net.bounce`,
  horizontal kept by `net.horizontalKeep`), so it skips across the net.
- Rim hits are faults and deflect the ball outward.
- The ball is only playable after it comes off the net or a player
  (`isPlayable` in `src/sim/hit.ts`).
- Hit quality comes from timing: how close the ball is to the player's
  contact height at contact. Bad hits are weaker and drift toward the rim.

## Roadmap

- [x] Phase 0: physics toy, broadcast camera, landing marker, one player, tuning panel
- [ ] Phase 1: local 2v2 (up to 4 gamepads + split keyboard), serving, 3-touch rule, scoring
- [ ] Phase 2: bots (teammate + opponents, difficulty levels)
- [ ] Phase 3: art, sound, hit effects, menus, join screen
- [ ] Phase 4: power-up modifiers + "Pure" mode
- [ ] Phase 5: replays, tournament mode, cosmetics

When changing physics, run `npm test` and play the drill. Feel matters more
than realism.
