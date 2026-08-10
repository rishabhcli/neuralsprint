import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { runBoundedChild } from './bounded-child.mjs';
import { REPOSITORY_ROOT, TMP_ROOT, ensureRuntimeDirectories } from './dev-contract.mjs';

const typescriptEntry = path.join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const viteEntry = path.join(REPOSITORY_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const distRoot = path.join(REPOSITORY_ROOT, 'dist');

/** @returns {NodeJS.ProcessEnv} */
function isolatedEnvironment() {
  const names = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'LANG',
    'LC_ALL',
    'TZ',
    'CI',
    'TERM',
    'COLORTERM',
    'NO_COLOR',
    'FORCE_COLOR',
    'DYLD_LIBRARY_PATH',
    'LD_LIBRARY_PATH',
  ];
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  for (const name of names) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  if (environment.NO_COLOR !== undefined) delete environment.FORCE_COLOR;
  return {
    ...environment,
    NODE_ENV: 'production',
    TMPDIR: TMP_ROOT,
    TMP: TMP_ROOT,
    TEMP: TMP_ROOT,
  };
}

async function ensureSafeDistRoot() {
  try {
    const metadata = await lstat(distRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('PRODUCTION_BUILD_DIST_UNSAFE: dist must be a real repository directory');
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
}

/**
 * @param {string} entry
 * @param {readonly string[]} args
 * @returns {Promise<void>}
 */
async function runNodeEntry(entry, args) {
  await runBoundedChild({
    command: process.execPath,
    args: [entry, ...args],
    cwd: REPOSITORY_ROOT,
    env: isolatedEnvironment(),
    stdio: 'inherit',
    timeoutMs: 120_000,
  });
}

/**
 * @param {{ typecheck: boolean }} options
 * @returns {Promise<void>}
 */
export async function runProductionBuild({ typecheck }) {
  await ensureRuntimeDirectories();
  await ensureSafeDistRoot();
  if (typecheck) await runTypecheck();
  await runNodeEntry(viteEntry, ['build', '--mode', 'production']);
}

/** @returns {Promise<void>} */
export async function runTypecheck() {
  await ensureRuntimeDirectories();
  await runNodeEntry(typescriptEntry, ['-b', '--pretty', 'false']);
}
