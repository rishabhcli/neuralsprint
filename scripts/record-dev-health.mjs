import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import { REPOSITORY_ROOT, TMP_ROOT, ensureRuntimeDirectories } from './lib/dev-contract.mjs';

await ensureRuntimeDirectories();
const result = await runBoundedChild({
  command: process.execPath,
  args: ['scripts/dev-lifecycle.mjs', 'health'],
  cwd: REPOSITORY_ROOT,
  env: {
    ...process.env,
    TMPDIR: TMP_ROOT,
    TMP: TMP_ROOT,
    TEMP: TMP_ROOT,
  },
  stdio: 'capture',
  timeoutMs: 45_000,
  maximumOutputBytes: 1024 * 1024,
});
if (result.stderr.byteLength > 0) {
  process.stderr.write(result.stderr);
  throw new Error('DEV_HEALTH_EVIDENCE_DIAGNOSTIC_REFUSED: health emitted stderr');
}

const events = result.stdout
  .toString('utf8')
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const services = events
  .filter((event) => event.event === 'dev.health.ready')
  .map(({ service, port, status }) => ({ service, port, status }))
  .sort((left, right) => left.port - right.port);
const reservedPortsFree = events
  .filter((event) => event.event === 'dev.health.reserved_free')
  .map(({ port }) => port)
  .sort((left, right) => left - right);

if (
  JSON.stringify(services.map(({ port }) => port)) !== JSON.stringify([4210, 4211, 4212, 4213]) ||
  services.some(({ status }) => status !== 'ready') ||
  JSON.stringify(reservedPortsFree) !== JSON.stringify([4214, 4215, 4216, 4217, 4218, 4219])
) {
  throw new Error('DEV_HEALTH_EVIDENCE_INCOMPLETE: the exclusive block was not fully verified');
}

const evidence = {
  schemaVersion: 1,
  command: 'npm run evidence:dev-health',
  seed: 20260809,
  host: '127.0.0.1',
  services,
  reservedPortsFree,
};

await mkdir(path.join(REPOSITORY_ROOT, 'evidence'), { recursive: true });
await writeFile(
  path.join(REPOSITORY_ROOT, 'evidence/dev-health.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
