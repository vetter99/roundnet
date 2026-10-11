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
src/ai/               CPU players (pure like the sim; they produce Intents)
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
- No rim faults for now: the frame bounces like the net.
- The ball is only playable after it comes off the net or a player
  (`isPlayable` in `src/sim/hit.ts`).
- 1v1 or 2v2 rallies (`src/sim/world.ts`, `world.format`, on-screen toggle):
  when the ball comes off the net, the other team has possession and must
  put it back on the net. In 2v2 no player may touch the ball twice in a row
  (`noDoubleTouch` in `Turn`); in 1v1 you can pass to yourself. The team without
  the ball can't hit it and gets pushed aside if it runs into the team with
  the ball. Two modes (on-screen toggle): practice (no score, serve
  alternates) and match (to `match.pointsToWin`, win by 2; the side that lets
  the ball land loses the point; the winner serves; `match.maxTouches`; a
  double fault gives the receiver the point).
- Serving is a duel (`src/sim/serve.ts`): the server aims a target on the net
  with the stick, holds a hit button to charge and releases; more charge =
  more aim wobble. Two tries per serve. No aim marker: the server holds the
  ball out in their off paw, and aiming slides the paw (`serveHand`); the
  serve leaves from there. While charging, the aim locks and sideways stick sets
  spin (`serve.spin`): the arm cocks to one side and sweeps across on
  release, and the serve curves that way. No steering after release. The
  receiver starts 2 m behind their serve line (`serve.receiverBack`). The
  renderer shows a camera straight behind the (see-through) receiver until
  the return; human stick input follows the camera.
  `feedBall` (feeding the ball off the net) is only a test/practice helper.
- Hits charge while the button is held and swing on release (`chargePower`).
- Dives are automatic: swinging at a ball just out of reach dives for it
  (`autoDiveTarget` in `src/sim/hit.ts`). There is no dive button.
- 2v2 serving: server and receiver straight across, partners to the sides
  (`partnerSpot`); a team rotates its server each time it wins the serve back
  (`setNextReceiver`, `world.serveOrder`).
- Characters (`src/render/roster.ts`) are built on the shared animated rig in
  `src/render/character.ts`. Defaults per seat: Blue 1 purple bear, Blue 2
  black cat, Red 1 TrufflesUpaGus (chihuahua matador, mushroom sombrero),
  Red 2 pinball machine; a 5th, Tattoo Guy, can be picked. The button next
  to each seat cycles its character (remembered in localStorage). Everyone
  wears a team-color jersey with their number.
- `src/ai/bot.ts` is a deterministic CPU player. In 2v2 the closer eligible
  teammate plays the ball, passes go to the partner, and the other supports
  or spreads out on defense. Seat buttons (Blue 1/2, Red 1/2) set each player
  to human or CPU (all CPU on load); humans get gamepads in seat order, then
  the keyboard (whole, or split WASD / arrows for two).
- Hit quality comes from timing: how close the ball is to the player's
  contact height at contact. Bad hits are weaker and drift off target.
- Spikes always target the net center; the stick only aims passes. The worst-
  timed spikes drift far enough past center to miss (`hit.mishitDrift`).

## Backlog

`docs/backlog.md` has the work items as self-contained cards (ID, priority,
size, files, "done when"). When asked to work on an item, read its card, keep
to its scope, and add tests for sim/AI changes.

## Roadmap

- [x] Phase 0: physics toy, broadcast camera, landing marker, one player, tuning panel
- [ ] Phase 1: local 2v2 (up to 4 gamepads + split keyboard), serving, 3-touch rule, scoring
  - [x] 1v1 with possession, 3 touches, scoring, CPU fallback for P2
  - [x] 2v2 with seat buttons, no double touches, serve rotation, CPU teammates (join screen still to do)
- [ ] Phase 2: bots (teammate + opponents, difficulty levels)
- [ ] Phase 3: art, sound, hit effects, menus, join screen
- [ ] Phase 4: power-up modifiers + "Pure" mode
- [ ] Phase 5: replays, tournament mode, cosmetics

When changing physics, run `npm test` and play the drill. Feel matters more
than realism.
