import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import {
  CACHE_ROOT,
  REPOSITORY_ROOT,
  TMP_ROOT,
  ensureRuntimeDirectories,
} from './lib/dev-contract.mjs';

await ensureRuntimeDirectories();
/** @type {NodeJS.ProcessEnv} */
const environment = {
  ...process.env,
  npm_config_cache: path.join(CACHE_ROOT, 'npm'),
  npm_config_engine_strict: 'true',
  npm_config_strict_allow_scripts: 'true',
  npm_config_strict_peer_deps: 'true',
  PLAYWRIGHT_BROWSERS_PATH: path.join(CACHE_ROOT, 'ms-playwright'),
  TMPDIR: TMP_ROOT,
  TMP: TMP_ROOT,
  TEMP: TMP_ROOT,
};
if (environment.NO_COLOR !== undefined) delete environment.FORCE_COLOR;

const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const warningPattern = /\b(?:[A-Za-z]*Warning|warn|deprecated|deprecation)\b/iu;

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {number} timeoutMs
 */
async function run(command, args, timeoutMs) {
  const result = await runBoundedChild({
    command,
    args,
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'capture',
    tee: true,
    timeoutMs,
    maximumOutputBytes: 8 * 1024 * 1024,
  });
  const warnings = Buffer.concat([result.stdout, result.stderr])
    .toString('utf8')
    .replace(ansiEscape, '')
    .split(/\r?\n/u)
    .filter((line) => warningPattern.test(line));
  if (warnings.length > 0) {
    throw new Error(
      `BOOTSTRAP_WARNING_REFUSED: ${command} ${args.join(' ')} emitted ${warnings.length} warning line(s): ${warnings.join(' | ')}`,
    );
  }
}

await run(process.execPath, ['scripts/verify-toolchain.mjs'], 45_000);
await run('npm', ['ci'], 480_000);
await run('npm', ['exec', '--', 'playwright', 'install', 'chromium'], 480_000);
