# Roundnet backlog

Draft for review. Every item is a self-contained card meant to become one
GitHub issue: one person (or one AI session) can pick it up without reading
the rest. Critique freely: reorder, cut, split, or rewrite.

**How to hand an item to the AI:** in Claude Code, say for example
*"Read CLAUDE.md and the MECH-01 card in docs/backlog.md, then implement it"*.
Once items are GitHub issues: *"Work on issue #12"*.

## Where things stand (2026-10-10)

- 1v1 mechanics sandbox: you (Blue) vs. a CPU (Red). No scoring.
- Hold to charge pass (A) / spike (B), release to swing; timing decides
  quality. Spikes always target the net center; only passes are aimed.
- Possession flips when the ball hits the net; the defender can't hit or
  bump into the team with the ball. Press A to serve (a stand-in feed).
- CPU usually passes to itself then spikes; misreads hard spikes more often.
- Squirrel characters, timing-ring landing guide, ball shadow, net wobble,
  synthesized SFX, chiptune music, dev stats panel, tuning panel (`).
- Deployed on Cloudflare Workers from GitHub `main`.

## Legend

- **Priority:** P0 = next up · P1 = soon · P2 = later · P3 = someday
- **Size:** S = under a day · M = a few days · L = a week or more
- **Areas:** MECH movement · SHOT shot types · RULE rules & modes ·
  AI CPU players · INPUT controls · UX menus & HUD · ART visuals ·
  AUDIO sound · TECH engineering · BUG known issues

## Summary

| ID | Title | Pri | Size | Depends on |
|---|---|---|---|---|
| MECH-01 | Dive | P0 | M | |
| MECH-02 | Jump-spike bonus | P0 | S | |
| MECH-03 | Recovery after weak hits and dives | P1 | S | MECH-01 |
| MECH-04 | Quick-step / pivot | P2 | S | |
| MECH-05 | Momentum into hits | P2 | M | |
| SHOT-01 | Drop shot (soft touch) | P0 | M | |
| SHOT-02 | Readable wind-up tells | P1 | M | |
| SHOT-03 | Fake / cancel a charge | P1 | S | |
| SHOT-04 | Spin shots (needs design decision) | P2 | M | |
| RULE-01 | Real serving | P0 | M | |
| RULE-02 | Match mode: scoring + 3-touch limit | P1 | S | RULE-01 |
| RULE-03 | 2v2 teams | P1 | L | RULE-02, INPUT-01 |
| RULE-04 | Serve rotation and side switching | P2 | S | RULE-03 |
| AI-01 | CPU difficulty levels | P1 | M | |
| AI-02 | CPU teammate | P1 | L | RULE-03 |
| AI-03 | Smarter defensive positioning | P1 | S | |
| AI-04 | CPU personalities | P3 | M | AI-01 |
| INPUT-01 | Join screen, up to 4 controllers | P1 | M | |
| INPUT-02 | Controller rumble | P1 | S | |
| INPUT-03 | Button remapping | P2 | M | UX-03 |
| INPUT-04 | Split keyboard for 2 players | P2 | S | INPUT-01 |
| INPUT-05 | Touch controls for phones | P3 | L | |
| UX-01 | Title screen | P1 | M | |
| UX-02 | Pause menu | P1 | S | |
| UX-03 | Settings screen | P1 | M | UX-02 |
| UX-04 | Hide dev panels for players | P0 | S | |
| UX-05 | How-to-play / tutorial | P2 | M | UX-01 |
| UX-06 | Character select | P2 | M | ART-03 |
| ART-01 | Court environment: park | P1 | M | |
| ART-02 | Ball and net models | P2 | S | |
| ART-03 | Character variety | P2 | M | |
| ART-04 | Celebrations and reactions | P2 | M | |
| ART-05 | Hit effects: particles, hit-stop, shake (deferred) | P3 | M | |
| ART-06 | Camera follow option | P2 | S | |
| AUDIO-01 | Music rotation + menu track | P2 | S | UX-01 |
| AUDIO-02 | Crowd reactions | P2 | M | |
| AUDIO-03 | Footsteps and landing sounds | P3 | S | |
| MODE-01 | Training drills | P2 | M | |
| MODE-02 | Party mode with power-ups | P3 | L | RULE-02 |
| MODE-03 | Tournament vs. CPU | P3 | L | AI-01, RULE-02 |
| TECH-01 | CI: typecheck, test, build on every PR | P0 | S | |
| TECH-02 | Linting and formatting | P0 | S | |
| TECH-03 | Contributor guide + PR template | P0 | S | |
| TECH-04 | Preview deploys per branch | P1 | S | |
| TECH-05 | Screenshot / visual check script | P1 | S | |
| TECH-06 | Replays from recorded inputs | P2 | M | |
| TECH-07 | Browser and controller compatibility pass | P1 | S | |
| TECH-08 | Performance: bundle size, FPS counter | P2 | S | |
| TECH-09 | Accessibility basics | P2 | S | |
| TECH-10 | Custom domain | P3 | S | |
| BUG-01 | Timing guide assumes the player is on the ground | P1 | S | |
| BUG-02 | Near-side player's tail may hide the ball (confirm) | P1 | S | |
| BUG-03 | Ball can be lost far away during a rally | P2 | S | |

---

## MECH: movement

### MECH-01 · Dive
**P0 · M** · Files: `src/sim/player.ts`, `src/input/localInput.ts`, `src/render/character.ts`, `src/config/tuning.ts`

A dive lets you reach balls just out of range, at a cost: you're on the
ground and helpless for a moment afterward.

- New button (proposal: X on controller, L on keyboard; X currently resets a
  stuck rally, which moves to the pause menu or Back/View).
- Dive in the stick direction: a short burst of speed, extended reach during
  the dive, then a recovery period with no movement or hits.
- Squirrel dive and get-up animations.

**Done when:** a ball 1.5–2 m away that you can't reach by running can be
saved with a well-timed dive, and a missed dive leaves you visibly
out of position. Dive distance, reach bonus and recovery time are in tuning.
Tests cover the dive path and the recovery lockout.

### MECH-02 · Jump-spike bonus
**P0 · S** · Files: `src/sim/hit.ts`, `src/config/tuning.ts`

Spiking near the top of a jump should pay off with a faster, steeper spike,
since it's harder to time.

**Done when:** a spike hit while airborne near the jump's peak gets a speed
bonus (tunable), shown in the dev panel. Grounded spikes are unchanged. Test
compares airborne vs. grounded spike speed.

### MECH-03 · Recovery after weak hits and dives
**P1 · S** · Depends on MECH-01 · Files: `src/sim/player.ts`

Mistakes should cost position, not just the ball: a short stumble after a
Weak hit or a dive.

**Done when:** after a Weak hit or a dive, the player moves at reduced speed
for a tunable time, with a stumble animation.

### MECH-04 · Quick-step / pivot
**P2 · S** · Files: `src/sim/player.ts`

A short burst to change direction quickly, on a cooldown, so good reads can
be rewarded with fast repositioning.

**Done when:** a quick-step button gives a short speed burst in the stick
direction with a tunable cooldown.

### MECH-05 · Momentum into hits
**P2 · M** · Files: `src/sim/hit.ts`

Running into a hit adds power in that direction; standing still gives a more
accurate hit. Creates a choice between moving and setting your feet.

**Open question:** does this interact with "spikes always target the net
center"? Probably momentum adds speed but not direction for spikes.

---

## SHOT: shot variety (the core of the strategy)

### SHOT-01 · Drop shot (soft touch)
**P0 · M** · Files: `src/sim/hit.ts`, `src/config/tuning.ts`

A soft spike that barely pops off the net, forcing the defender to rush in.
It beats a defender standing far back.

- Proposal: a quick tap of B (very low charge) plays a drop shot: slow
  speed, steep angle into the net, so it bounces up low and short.
- Must stay distinct from a mistimed weak spike (which drifts and can miss).

**Done when:** a tapped spike lands within ~1.5 m of the net after the bounce,
while a charged spike carries 3 m or more. The CPU has to sprint to return
drop shots. Test checks both distances.

### SHOT-02 · Readable wind-up tells
**P1 · M** · Files: `src/render/character.ts`

Good defenders should be able to read what's coming: a big wind-up for a power
spike, a short one for a drop shot.

**Done when:** the charge pose visibly differs by charge level (drop vs. power)
so an attentive player can anticipate the shot.

### SHOT-03 · Fake / cancel a charge
**P1 · S** · Files: `src/sim/player.ts`

Pressing the other hit button while charging cancels the charge without
swinging, to bait the defender into committing early.

**Done when:** cancel works with no swing, no hit, and a short cooldown before
charging again.

### SHOT-04 · Spin shots (needs design decision)
**P2 · M**

Real roundnet uses spin to curve the bounce. We removed spike aiming, so spin
needs a different input (e.g. holding a shoulder button while releasing).
**Decide first:** do we want any directional control on spikes at all?

---

## RULE: rules and modes

### RULE-01 · Real serving
**P0 · M** · Files: `src/sim/world.ts`, `src/ai/bot.ts`, `src/render/renderer.ts`

Replace the "fed off the net" stand-in with a real serve: the server stands
behind the serve line, tosses with one press and hits with the release.

**Done when:** the server must be behind the serve line; serve speed and
quality come from timing like other hits; a serve that misses the net is a
fault (re-serve for now, a point later in match mode); the CPU serves the
same way. Tests cover a legal serve, a fault and a foot fault.

### RULE-02 · Match mode: scoring + 3-touch limit
**P1 · S** · Depends on RULE-01 · Files: `src/sim/world.ts`, `src/main.ts`

Bring back scoring (rally scoring to 21, win by 2) and the 3-touch limit as a
**Match** mode, keeping today's **Practice** mode. Most of this code exists in
commit `3359c7b` and can be restored from there.

**Done when:** a mode setting switches between Practice (today) and Match
(scoring, touch limit, win screen, rematch).

### RULE-03 · 2v2 teams
**P1 · L** · Depends on RULE-02, INPUT-01

Four players, two per team. Possession is per team; a player can't touch the
ball twice in a row; teammates share the 3 touches.

**Done when:** a 2v2 match is playable with any mix of humans and CPUs,
and the possession ring shows the whole team in possession.

### RULE-04 · Serve rotation and side switching
**P2 · S** · Depends on RULE-03

Real roundnet serving order and side changes.

---

## AI: CPU players

### AI-01 · CPU difficulty levels
**P1 · M** · Files: `src/ai/bot.ts`

Easy / Medium / Hard as presets of the existing bot constants (reaction time,
misread rate, timing error, shot choice), chosen in settings.

**Done when:** CPU-vs-CPU and a scripted-human test show clearly different
return rates per level (roughly Easy 70%, Medium 85%, Hard 95% of medium
spikes).

### AI-02 · CPU teammate
**P1 · L** · Depends on RULE-03

A CPU partner in 2v2 that covers space, sets you up and doesn't steal your
ball.

### AI-03 · Smarter defensive positioning
**P1 · S** · Files: `src/ai/bot.ts`

Today the CPU waits directly opposite the attacker. It should also cover drop
shots (once SHOT-01 exists) and shift based on the attacker's position.

### AI-04 · CPU personalities
**P3 · M**

Power hitter, trickster (drops and fakes), wall defender.

---

## INPUT: controls

### INPUT-01 · Join screen, up to 4 controllers
**P1 · M** · Files: `src/main.ts`, `src/input/localInput.ts`

"Press A to join" screen: each controller (and the keyboard) claims a player
slot and picks a team; empty slots are CPUs. Code for multiple gamepads
already exists in `LocalInput`.

### INPUT-02 · Controller rumble
**P1 · S** · Files: `src/input/localInput.ts`, `src/main.ts`

Short vibration on hits (stronger for power and PERFECT), using the Gamepad
`vibrationActuator` API where supported.

### INPUT-03 · Button remapping
**P2 · M** · Depends on UX-03

### INPUT-04 · Split keyboard for 2 players
**P2 · S** · Depends on INPUT-01

WASD side and arrow-keys side on one keyboard.

### INPUT-05 · Touch controls for phones
**P3 · L**

Virtual stick and buttons. Needs a performance check on phones first.

---

## UX: menus and HUD

### UX-01 · Title screen
**P1 · M**

Logo, Play, Settings, Credits. Clicking Play also unlocks audio, which removes
the "click to turn on sound" step.

### UX-02 · Pause menu
**P1 · S**

Start/Menu or Esc pauses the sim (the fixed-tick loop just stops stepping).
Resume, restart, settings, quit to title. "Reset stuck ball" moves here.

### UX-03 · Settings screen
**P1 · M**

Player-facing settings: volumes, timing guide on/off, CPU difficulty,
controls help. Separate from the developer tuning panel.

### UX-04 · Hide dev panels for players
**P0 · S** · Files: `src/main.ts`, `index.html`

The dev stats panel and tuning panel should only appear in development
(or with a `?dev` URL flag), so friends see a clean screen.

**Done when:** the deployed site shows no dev panel by default; `?dev` or
`npm run dev` shows both.

### UX-05 · How-to-play / tutorial
**P2 · M** · Depends on UX-01

A short interactive tutorial: move, pass, spike with timing, serve.

### UX-06 · Character select
**P2 · M** · Depends on ART-03

---

## ART: visuals

### ART-01 · Court environment: park
**P1 · M** · Files: `src/render/renderer.ts`

Replace the flat green plane: grass texture, trees, a path, sky, soft shadows
under players.

### ART-02 · Ball and net models
**P2 · S**

Ball with Spikeball-style dimples; net with visible mesh and legs.

### ART-03 · Character variety
**P2 · M** · Files: `src/render/character.ts`

Fur colors, shirts and accessories; later other animals (chipmunk, raccoon,
rabbit).

### ART-04 · Celebrations and reactions
**P2 · M**

Happy hop after a PERFECT or a won rally, a slump after a miss.

### ART-05 · Hit effects: particles, hit-stop, shake (deferred)
**P3 · M**

Discussed and deliberately postponed. Keep for later polish.

### ART-06 · Camera follow option
**P2 · S** · Files: `src/render/renderer.ts`

Slight drift toward the action, as an option. The fixed broadcast camera stays
the default.

---

## AUDIO

### AUDIO-01 · Music rotation + menu track
**P2 · S** · Depends on UX-01

Rotate Stage 1 / Stage 2 from the same Chiptune Adventures pack (CC0) during
play; Stage Select on menus.

### AUDIO-02 · Crowd reactions
**P2 · M** · Files: `src/audio/`

Murmur that builds with rally length, cheer on long rallies, "ooh" on near
misses. Real CC0 recordings preferred over synthesis (the synthesized breeze
sounded like a plane cabin).

### AUDIO-03 · Footsteps and landing sounds
**P3 · S**

---

## MODE: game modes

### MODE-01 · Training drills
**P2 · M**

Receiving drill, target practice (land spikes in a zone), serve practice,
each with a score to beat.

### MODE-02 · Party mode with power-ups
**P3 · L** · Depends on RULE-02

Power-ups built as modifiers that hook into sim events (see CLAUDE.md rule 5),
so Pure mode stays untouched.

### MODE-03 · Tournament vs. CPU
**P3 · L** · Depends on AI-01, RULE-02

A short ladder of CPU teams of rising difficulty.

---

## TECH: engineering

### TECH-01 · CI: typecheck, test, build on every PR
**P0 · S** · Files: `.github/workflows/ci.yml`

GitHub Actions on Node 22 running `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`. Required to pass before merging to `main`, since every push to
`main` deploys.

### TECH-02 · Linting and formatting
**P0 · S**

ESLint + Prettier with a pre-commit hook, so many contributors (and AI
sessions) produce consistent code. One big "format everything" commit first.

### TECH-03 · Contributor guide + PR template
**P0 · S** · Files: `CONTRIBUTING.md`, `.github/pull_request_template.md`

Branch naming, "one backlog item per PR", how to run tests and the tuning
panel, how to hand an issue to the AI.

### TECH-04 · Preview deploys per branch
**P1 · S**

Cloudflare preview URLs for branches/PRs, so reviewers can play a change
before it merges.

### TECH-05 · Screenshot / visual check script
**P1 · S**

`npm run screenshot` using headless Chrome (the approach used so far during
development), so anyone can check a visual change without opening the game.

### TECH-06 · Replays from recorded inputs
**P2 · M**

The sim is deterministic, so recording each tick's intents replays any rally
exactly. Useful for bug reports ("attach the replay") and for tuning.

### TECH-07 · Browser and controller compatibility pass
**P1 · S**

Check Chrome, Safari, Firefox and Edge, with Xbox, PlayStation and Switch Pro
controllers. Write down what works in the README.

### TECH-08 · Performance: bundle size, FPS counter
**P2 · S**

Code-split Babylon, add an FPS counter to the dev panel, check a low-end laptop.

### TECH-09 · Accessibility basics
**P2 · S**

Colorblind-safe team colors (blue/red is borderline), an option to turn off
flashing text, readable font sizes.

### TECH-10 · Custom domain
**P3 · S**

---

## BUG: known issues

### BUG-01 · Timing guide assumes the player is on the ground
**P1 · S** · Files: `src/render/renderer.ts`

The rings turn green when the ball reaches standing contact height. When
jumping, the perfect moment is later. The guide should use the human
player's current height.

### BUG-02 · Near-side player's tail may hide the ball (confirm)
**P1 · S** · Files: `src/render/character.ts`

Seen in screenshots, not yet confirmed in play: from the broadcast camera,
Blue's big tail looks like it could cover the ball when it's close. Options: smaller or more transparent tail on the near player, or a
ball outline that shows through.

### BUG-03 · Ball can be lost far away during a rally
**P2 · S**

A badly mistimed hit can land far from the court. Fine for now (the rally
ends), but needs court bounds or a "ball out" call once scoring returns.
