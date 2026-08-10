import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import {
  CACHE_ROOT,
  REPOSITORY_ROOT,
  TMP_ROOT,
  ensureRuntimeDirectories,
} from './lib/dev-contract.mjs';

const arguments_ = process.argv.slice(2);
let output = 'evidence/tier0-verify.log';
let requireClean = false;

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === '--require-clean') {
    requireClean = true;
    continue;
  }
  if (argument === '--output' && arguments_[index + 1] !== undefined) {
    output = /** @type {string} */ (arguments_[index + 1]);
    index += 1;
    continue;
  }
  throw new Error(`VERIFY_CAPTURE_ARGUMENT_INVALID: unsupported argument ${String(argument)}`);
}

if (!/^evidence\/[a-z0-9][a-z0-9.-]*\.log$/u.test(output)) {
  throw new Error('VERIFY_CAPTURE_OUTPUT_INVALID: output must be a log directly under evidence/');
}

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

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {number} timeoutMs
 * @param {number} [maximumOutputBytes]
 */
async function captureCommand(command, args, timeoutMs, maximumOutputBytes = 1024 * 1024) {
  const result = await runBoundedChild({
    command,
    args,
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'capture',
    timeoutMs,
    maximumOutputBytes,
  });
  if (result.stderr.byteLength > 0) {
    throw new Error(
      `VERIFY_CAPTURE_DIAGNOSTIC_REFUSED: ${command} ${args.join(' ')} emitted stderr`,
    );
  }
  return result.stdout.toString('utf8');
}

const [commitOutput, statusOutput] = await Promise.all([
  captureCommand('git', ['rev-parse', 'HEAD'], 30_000),
  captureCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], 30_000),
]);
const commit = commitOutput.trim();
const cleanBefore = statusOutput.trim().length === 0;
if (requireClean && !cleanBefore) {
  throw new Error(
    'VERIFY_CAPTURE_CHECKOUT_DIRTY: --require-clean refuses a checkout with tracked or untracked changes',
  );
}

const publicCommand = requireClean
  ? 'npm run evidence:clean-verify'
  : 'npm run evidence:verify-all';
const header = Buffer.from(
  [
    `# command: ${publicCommand}`,
    '# delegated-command: npm run verify-all',
    '# seed: 20260809',
    `# git-commit: ${commit}`,
    `# git-status-before: ${cleanBefore ? 'clean' : 'dirty'}`,
    `# checkout-policy: ${requireClean ? 'clean-required' : 'working-tree-diagnostic'}`,
    '',
  ].join('\n'),
);
const maximumBytes = 16 * 1024 * 1024;
const temporary = path.join(TMP_ROOT, `${path.basename(output)}.capture`);
const destination = path.join(REPOSITORY_ROOT, output);

await mkdir(path.dirname(destination), { recursive: true });
/** @type {unknown} */
let execution;
/** @type {Error | undefined} */
let executionFailure;
try {
  execution = await runBoundedChild({
    command: 'npm',
    args: ['run', 'verify-all'],
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'capture',
    tee: true,
    timeoutMs: 30 * 60_000,
    maximumOutputBytes: maximumBytes - header.byteLength,
  });
} catch (error) {
  executionFailure = /** @type {Error} */ (error);
  execution = error;
}

const executionOutput = /** @type {{ stdout?: unknown; stderr?: unknown } | null | undefined} */ (
  execution
);
const capturedStdout = Buffer.isBuffer(executionOutput?.stdout)
  ? executionOutput.stdout
  : Buffer.alloc(0);
const capturedStderr = Buffer.isBuffer(executionOutput?.stderr)
  ? executionOutput.stderr
  : Buffer.alloc(0);
const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const portableLog = Buffer.concat([header, capturedStdout, capturedStderr])
  .toString('utf8')
  .replaceAll(REPOSITORY_ROOT, '<repository-root>')
  .replace(ansiEscape, '')
  .replaceAll('\r\n', '\n')
  .replace(/\r(?=[^\n]|$)/gu, '\n')
  .replace(/[ \t]+(?=\n|$)/gu, '');
await writeFile(temporary, portableLog.endsWith('\n') ? portableLog : `${portableLog}\n`);

if (executionFailure !== undefined) {
  throw new Error(`VERIFY_CAPTURE_FAILED: ${executionFailure.message}; log=${temporary}`, {
    cause: executionFailure,
  });
}
if (requireClean) {
  const statusAfter = await captureCommand(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    30_000,
  );
  if (statusAfter.trim().length > 0) {
    throw new Error(
      `VERIFY_CAPTURE_REGENERATION_DRIFT: committed evidence or sources changed during clean verification: ${statusAfter.trim()}; log=${temporary}`,
    );
  }
}

await rename(temporary, destination);
process.stdout.write(
  `verify-all evidence written to ${path.relative(REPOSITORY_ROOT, destination)}\n`,
);
