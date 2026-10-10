---
name: Task
about: A feature, change or bug, written so a teammate or the AI can pick it up alone
title: "[AREA-00] Short title"
labels: ''
---

<!--
Same format as the cards in docs/backlog.md. Labels to add:
area:mech | area:shot | area:rule | area:ai | area:input | area:ux | area:art | area:audio | area:tech | bug
priority:P0..P3, size:S/M/L
To hand this to Claude Code: "Read CLAUDE.md, then work on issue #<number>".
-->

## Why
What problem this solves or what it adds for the player.

## What
The change, in a few bullets. Note anything deliberately out of scope.

## Done when
- [ ] Observable behavior that proves it works (in the game or the dev panel)
- [ ] New tunables are in `src/config/tuning.ts` with slider ranges
- [ ] Tests cover the sim/AI logic (`npm test` passes)

## Where
Likely files, e.g. `src/sim/hit.ts`, `src/render/character.ts`.

## Depends on
Other issues that must land first, if any.

## Open questions
Design decisions to settle before or during the work.
