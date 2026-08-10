import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const forbiddenRuntimePrimitives = [
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\s*\(/u,
  /\bsendBeacon\s*\(/u,
  /https?:\/\//u,
] as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return /\.(?:ts|tsx|css)$/u.test(entry.name) ? [absolute] : [];
    }),
  );
  return nested.flat();
}

describe('foundation runtime network surface', () => {
  it('contains no client network primitive or remote asset origin', async () => {
    const files = await sourceFiles(path.resolve('src'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const forbidden of forbiddenRuntimePrimitives) {
        expect(source, `${file} must not match ${String(forbidden)}`).not.toMatch(forbidden);
      }
    }
  });
});
