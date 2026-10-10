import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the architecture rule from CLAUDE.md: the sim (and the bots, which
// run inside it) are pure, deterministic game logic that never touch
// rendering, the DOM, time or randomness.
const FORBIDDEN = [
  /from ['"]@babylonjs/,
  /from ['"]\.\.\/(render|input|debug)/,
  /Math\.random/,
  /Date\.now|performance\.now|new Date/,
  /\b(window|document|navigator)\./,
];

describe('sim purity', () => {
  const dirs = [__dirname, join(__dirname, '../ai')];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(dir, f)),
  );

  it.each(files)('%s has no forbidden imports or calls', (file) => {
    const source = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
  });
});
