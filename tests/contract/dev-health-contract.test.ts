import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { validateReadyDocument } from '../../scripts/lib/service-health.mjs';

const exactReadyDocument = {
  schemaVersion: 1,
  repository: 'neuralsprint',
  service: 'app-dev',
  host: '127.0.0.1',
  port: 4210,
  status: 'ready',
  checks: [{ name: 'app-html', status: 'pass' }],
} as const;

describe('development health contract', () => {
  it('accepts only a service-specific semantic readiness document', () => {
    expect(validateReadyDocument(exactReadyDocument, 'app-dev', 4210)).toBe(exactReadyDocument);

    for (const mutation of [
      { ...exactReadyDocument, repository: 'foreign' },
      { ...exactReadyDocument, service: 'preview' },
      { ...exactReadyDocument, host: '0.0.0.0' },
      { ...exactReadyDocument, port: 5173 },
      { ...exactReadyDocument, status: 'alive' },
      { ...exactReadyDocument, checks: [] },
      { ...exactReadyDocument, checks: [{ name: 'app-html', status: 'fail' }] },
    ]) {
      expect(() => validateReadyDocument(mutation, 'app-dev', 4210)).toThrow(
        'DEV_READINESS_INVALID',
      );
    }
  });

  it('pins Vite and Playwright to loopback and the explicit port allocation', async () => {
    const [vite, playwright, lifecycle] = await Promise.all([
      readFile('vite.config.ts', 'utf8'),
      readFile('playwright.config.ts', 'utf8'),
      readFile('scripts/dev-lifecycle.mjs', 'utf8'),
    ]);

    expect(vite).toContain("const loopbackHost = '127.0.0.1'");
    expect(vite).toContain('port: 4210');
    expect(vite).toContain('port: 4211');
    expect(vite.match(/strictPort: true/gu)).toHaveLength(2);
    expect(playwright).toContain("const playwrightOrigin = 'http://127.0.0.1:4212'");
    expect(playwright).toContain('NEURALSPRINT_REUSE_OWNED_SERVER');
    expect(playwright).toContain("reuseSetting === '1' && isExplicitlyOwnedPlaywrightServer()");
    expect(lifecycle).not.toMatch(/\bpkill\b|\bkillall\b|docker\s+(?:kill|system\s+prune)/u);
  });

  it('uses typed HTTP readiness rather than a TCP-open check', async () => {
    const [probeSource, serviceSource, lifecycle] = await Promise.all([
      readFile('scripts/lib/readiness-probes.mjs', 'utf8'),
      readFile('scripts/dev-service.mjs', 'utf8'),
      readFile('scripts/dev-lifecycle.mjs', 'utf8'),
    ]);

    expect(probeSource).toContain('validateReadyDocument');
    expect(probeSource).toContain('probeSemanticSurface');
    expect(probeSource).toContain('fixture-pdf-integrity');
    expect(probeSource).toContain("redirect: 'manual'");
    expect(serviceSource).toContain('healthController.markReady(checks)');
    expect(lifecycle).toContain("state === 'owned-healthy'");
    expect(lifecycle).toContain("event: 'dev.health.reserved_free'");
  });

  it('exposes no package script that bypasses lifecycle ownership', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBeUndefined();
    expect(packageJson.scripts.preview).toBeUndefined();
    expect(packageJson.scripts['dev:e2e']).toBeUndefined();
    expect(packageJson.scripts['dev:up']).toBe('node scripts/dev-lifecycle.mjs up');
    expect(packageJson.scripts['dev:down']).toBe('node scripts/dev-lifecycle.mjs down');
  });
});
