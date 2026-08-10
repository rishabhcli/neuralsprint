#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import {
  CACHE_ROOT,
  LOOPBACK_HOST,
  PLAYWRIGHT_PROFILE_ROOT,
  REPOSITORY_ROOT,
  TMP_ROOT,
  ensureRuntimeDirectories,
  isExactLoopbackListener,
  isTrustedPidRecord,
  listPortListeners,
  readPidRecord,
  serviceSpec,
} from './lib/dev-contract.mjs';

async function hasOwnedPlaywrightListener() {
  let record;
  try {
    record = await readPidRecord('playwright');
  } catch {
    return false;
  }
  if (record === undefined || !(await isTrustedPidRecord(record))) return false;

  const spec = serviceSpec('playwright');
  const listeners = await listPortListeners(spec.port);
  return (
    listeners.length === 1 &&
    listeners[0]?.pid === record.pid &&
    isExactLoopbackListener(listeners[0], spec.port)
  );
}

/** @param {'up' | 'health'} command */
async function runLifecycle(command) {
  await runBoundedChild({
    command: process.execPath,
    args: ['scripts/dev-lifecycle.mjs', command],
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      TMPDIR: TMP_ROOT,
      TMP: TMP_ROOT,
      TEMP: TMP_ROOT,
    },
    stdio: 'inherit',
    timeoutMs: command === 'up' ? 180_000 : 45_000,
  });
}

async function main() {
  await ensureRuntimeDirectories();
  const require = createRequire(import.meta.url);
  const playwrightCli = require.resolve('@playwright/test/cli');
  await runLifecycle('up');
  await runLifecycle('health');
  const owned = await hasOwnedPlaywrightListener();
  const environment = { ...process.env };
  delete environment.NO_COLOR;
  environment.PLAYWRIGHT_BROWSERS_PATH = path.join(CACHE_ROOT, 'ms-playwright');
  environment.TMPDIR = PLAYWRIGHT_PROFILE_ROOT;
  environment.TMP = PLAYWRIGHT_PROFILE_ROOT;
  environment.TEMP = PLAYWRIGHT_PROFILE_ROOT;
  if (owned) environment.NEURALSPRINT_REUSE_OWNED_SERVER = '1';
  else delete environment.NEURALSPRINT_REUSE_OWNED_SERVER;

  process.stdout.write(
    `${JSON.stringify({
      event: 'dev.playwright.launch',
      host: LOOPBACK_HOST,
      port: 4212,
      reuseOwnedServer: owned,
    })}\n`,
  );

  await runBoundedChild({
    command: process.execPath,
    args: [playwrightCli, 'test', ...process.argv.slice(2)],
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'inherit',
    timeoutMs: 300_000,
  });
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ code: error?.code ?? 'DEV_PLAYWRIGHT_LAUNCH_FAILED', message: error?.message ?? String(error) })}\n`,
  );
  process.exitCode = 1;
});
