import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  collectInstallScriptPackages,
  validateInstallScriptPolicy,
} from './lib/dependency-policy.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
const npmConfiguration = await readFile(new URL('../.npmrc', import.meta.url), 'utf8');
const nodeVersionFile = (
  await readFile(new URL('../.node-version', import.meta.url), 'utf8')
).trim();
const nvmVersionFile = (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim();
const repositoryUrl = new URL('../', import.meta.url);
const [nodeMajor = 0] = process.versions.node.split('.').map(Number);

const nodeSupported = process.versions.node === '24.19.0' || nodeMajor === 26;

if (!nodeSupported) {
  throw new Error(
    `TOOLCHAIN_NODE_UNSUPPORTED: received ${process.versions.node}; expected Node 24.19.0 LTS or Node 26 compatibility`,
  );
}

const probeOptions = Object.freeze({
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
  timeout: 15_000,
});

const npmResult = spawnSync('npm', ['--version'], probeOptions);
if (npmResult.status !== 0) {
  throw new Error('TOOLCHAIN_NPM_UNAVAILABLE: npm --version failed');
}

const npmVersion = npmResult.stdout.trim();
if (npmVersion !== '11.17.0') {
  throw new Error(`TOOLCHAIN_NPM_UNSUPPORTED: received ${npmVersion}; expected npm 11.17.0`);
}

if (packageJson.packageManager !== 'npm@11.17.0') {
  throw new Error('TOOLCHAIN_PACKAGE_MANAGER_UNPINNED: packageManager must be npm@11.17.0');
}
if (
  nodeVersionFile !== '24.19.0' ||
  nvmVersionFile !== '24.19.0' ||
  packageJson.engines?.node !== '24.19.0 || >=26.0.0 <27' ||
  packageJson.engines?.npm !== '11.17.0' ||
  packageLock.packages?.['']?.engines?.node !== packageJson.engines.node ||
  packageLock.packages?.['']?.engines?.npm !== packageJson.engines.npm
) {
  throw new Error(
    'TOOLCHAIN_VERSION_PIN_DRIFT: runtime files, package engines, and lockfile must match the Node 24.19.0/npm 11.17.0 contract',
  );
}

const requiredNpmConfiguration = new Map([
  ['cache', '.dev/cache/npm'],
  ['engine-strict', 'true'],
  ['fund', 'false'],
  ['save-exact', 'true'],
  ['strict-allow-scripts', 'true'],
  ['strict-peer-deps', 'true'],
]);
const observedNpmConfiguration = new Map();
for (const sourceLine of npmConfiguration.split(/\r?\n/u)) {
  const line = sourceLine.trim();
  if (line.length === 0 || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) throw new Error(`TOOLCHAIN_NPM_CONFIG_INVALID: ${line}`);
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (key !== key.toLowerCase()) {
    throw new Error(`TOOLCHAIN_NPM_CONFIG_INVALID: keys must be lowercase (${key})`);
  }
  if (observedNpmConfiguration.has(key)) {
    throw new Error(`TOOLCHAIN_NPM_CONFIG_DUPLICATE: ${key}`);
  }
  observedNpmConfiguration.set(key, value);
}
if (observedNpmConfiguration.size !== requiredNpmConfiguration.size) {
  throw new Error('TOOLCHAIN_NPM_CONFIG_UNDECLARED: .npmrc must contain only reviewed settings');
}
for (const [key, expected] of requiredNpmConfiguration) {
  if (observedNpmConfiguration.get(key) !== expected) {
    throw new Error(`TOOLCHAIN_NPM_CONFIG_UNSAFE: ${key} must be exactly ${expected}`);
  }
}
validateInstallScriptPolicy(packageJson, collectInstallScriptPackages(packageLock));

const effectiveNpmConfiguration = new Map([
  ['cache', fileURLToPath(new URL('../.dev/cache/npm', import.meta.url))],
  ['engine-strict', 'true'],
  ['strict-allow-scripts', 'true'],
  ['strict-peer-deps', 'true'],
]);
for (const [key, expected] of effectiveNpmConfiguration) {
  const result = spawnSync('npm', ['config', 'get', key], {
    ...probeOptions,
    cwd: repositoryUrl,
  });
  if (result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error(
      `TOOLCHAIN_NPM_CONFIG_OVERRIDDEN: effective ${key} must be exactly ${expected}`,
    );
  }
}

/** @type {readonly (readonly [string, readonly string[]])[]} */
const requiredCommands =
  process.platform === 'win32'
    ? [
        [
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Get-Command Get-NetTCPConnection'],
        ],
        ['git', ['--version']],
      ]
    : [
        ['git', ['--version']],
        ['lsof', ['-v']],
        ['ps', ['-p', String(process.pid), '-o', 'command=']],
      ];
for (const [command, args] of requiredCommands) {
  const result = spawnSync(command, args, probeOptions);
  if (result.status !== 0) {
    throw new Error(
      `TOOLCHAIN_SYSTEM_COMMAND_UNAVAILABLE: ${command} is required by the repository lifecycle`,
    );
  }
}

process.stdout.write(
  `toolchain ready: node=${process.versions.node} npm=${npmVersion} platform=${process.platform}-${process.arch} systemCommands=${requiredCommands.map(([command]) => command).join(',')}\n`,
);
