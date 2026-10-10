import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the architecture rule from CLAUDE.md: the sim is pure, deterministic
// game logic that never touches rendering, the DOM, time or randomness.
const FORBIDDEN = [
  /from ['"]@babylonjs/,
  /from ['"]\.\.\/(render|input|debug)/,
  /Math\.random/,
  /Date\.now|performance\.now|new Date/,
  /\b(window|document|navigator)\./,
];

describe('sim purity', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it.each(files)('%s has no forbidden imports or calls', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const pattern of FORBIDDEN) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
  });
});
