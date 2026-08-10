import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const devRoot = path.join(repositoryRoot, '.dev');
const profileRoot = path.join(devRoot, 'pw-profile');
const playwrightPidFile = path.join(devRoot, 'pids', 'playwright.json');
const serviceEntry = path.join(repositoryRoot, 'scripts', 'dev-service.mjs');
const playwrightOrigin = 'http://127.0.0.1:4212';

mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
process.env.TMPDIR = profileRoot;
process.env.TMP = profileRoot;
process.env.TEMP = profileRoot;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isExplicitlyOwnedPlaywrightServer(): boolean {
  try {
    const stat = lstatSync(playwrightPidFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const value = JSON.parse(readFileSync(playwrightPidFile, 'utf8')) as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      value.repository !== 'neuralsprint' ||
      value.service !== 'playwright' ||
      value.port !== 4212 ||
      value.root !== repositoryRoot ||
      typeof value.pid !== 'number' ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 1 ||
      typeof value.ownerToken !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.ownerToken) ||
      !processIsAlive(value.pid)
    ) {
      return false;
    }

    const command = execFileSync('ps', ['-ww', '-p', String(value.pid), '-o', 'command='], {
      encoding: 'utf8',
    });
    if (
      !command.includes(serviceEntry) ||
      !command.includes('--service playwright') ||
      !command.includes('--port 4212') ||
      !command.includes(`--owner-token ${value.ownerToken}`)
    ) {
      return false;
    }

    const listener = execFileSync(
      'lsof',
      ['-nP', '-a', '-p', String(value.pid), '-iTCP:4212', '-sTCP:LISTEN', '-Fn'],
      { encoding: 'utf8' },
    );
    return listener.split(/\r?\n/u).some((line) => line === 'n127.0.0.1:4212');
  } catch {
    return false;
  }
}

const reuseSetting = process.env.NEURALSPRINT_REUSE_OWNED_SERVER;
if (reuseSetting !== undefined && reuseSetting !== '0' && reuseSetting !== '1') {
  throw new Error('DEV_PLAYWRIGHT_REUSE_INVALID: NEURALSPRINT_REUSE_OWNED_SERVER must be 0 or 1');
}
const reuseExistingServer = reuseSetting === '1' && isExplicitlyOwnedPlaywrightServer();
const ownerToken = randomBytes(32).toString('hex');
const serverCommand = [
  JSON.stringify(process.execPath),
  JSON.stringify(serviceEntry),
  '--service',
  'playwright',
  '--port',
  '4212',
  '--owner-token',
  ownerToken,
].join(' ');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.dev/tmp/playwright-results',
  fullyParallel: true,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.dev/tmp/playwright-report' }]],
  use: {
    baseURL: playwrightOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: serverCommand,
    url: `${playwrightOrigin}/__neuralsprint/ready`,
    reuseExistingServer,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
