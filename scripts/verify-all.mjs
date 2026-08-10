import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import {
  CACHE_ROOT,
  REPOSITORY_ROOT,
  TMP_ROOT,
  ensureRuntimeDirectories,
} from './lib/dev-contract.mjs';

const steps = [
  { command: 'node', args: ['scripts/verify-toolchain.mjs'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'format:check'], timeoutMs: 180_000 },
  { command: 'npm', args: ['run', 'lint'], timeoutMs: 300_000 },
  { command: 'npm', args: ['run', 'typecheck'], timeoutMs: 240_000 },
  { command: 'npm', args: ['run', 'boundaries'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'dependencies:check'], timeoutMs: 120_000 },
  { command: 'npm', args: ['audit', '--audit-level=high'], timeoutMs: 300_000 },
  {
    command: 'npm',
    args: ['audit', '--omit=dev', '--audit-level=high'],
    timeoutMs: 300_000,
  },
  { command: 'npm', args: ['run', 'dev:down'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'dev:preflight'], timeoutMs: 90_000 },
  { command: 'npm', args: ['run', 'dev:up'], timeoutMs: 300_000 },
  { command: 'npm', args: ['run', 'dev:health'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'evidence:dev-health'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'test'], timeoutMs: 600_000 },
  { command: 'npm', args: ['run', 'test:e2e'], timeoutMs: 420_000 },
  { command: 'npm', args: ['run', 'test:accessibility'], timeoutMs: 420_000 },
  { command: 'npm', args: ['run', 'eval'], timeoutMs: 120_000 },
  { command: 'npm', args: ['run', 'release:metadata'], timeoutMs: 300_000 },
];

const maximumDiagnosticBytes = 8 * 1024 * 1024;
const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const warningPattern = /\b(?:[A-Za-z]*Warning|warn|deprecated|deprecation)\b/iu;

await ensureRuntimeDirectories();
/** @type {NodeJS.ProcessEnv} */
const environment = {
  ...process.env,
  npm_config_cache: path.join(CACHE_ROOT, 'npm'),
  PLAYWRIGHT_BROWSERS_PATH: path.join(CACHE_ROOT, 'ms-playwright'),
  TMPDIR: TMP_ROOT,
  TMP: TMP_ROOT,
  TEMP: TMP_ROOT,
};
if (environment.NO_COLOR !== undefined) delete environment.FORCE_COLOR;

for (const { command, args, timeoutMs } of steps) {
  process.stdout.write(`\n[verify-all] ${command} ${args.join(' ')}\n`);
  const result = await runBoundedChild({
    command,
    args,
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'capture',
    tee: true,
    timeoutMs,
    maximumOutputBytes: maximumDiagnosticBytes,
  });
  const warnings = Buffer.concat([result.stdout, result.stderr])
    .toString('utf8')
    .replace(ansiEscape, '')
    .split(/\r?\n/u)
    .filter((line) => warningPattern.test(line));
  if (warnings.length > 0) {
    throw new Error(
      `VERIFY_WARNING_REFUSED: ${command} ${args.join(' ')} emitted ${warnings.length} warning line(s): ${warnings.join(' | ')}`,
    );
  }
}

process.stdout.write('\n[verify-all] all Tier 0 executable-contract checks passed\n');
