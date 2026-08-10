import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  collectInstallScriptPackages,
  validateInstallScriptPolicy,
} from './lib/dependency-policy.mjs';

const root = path.resolve('.');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLockBytes = await readFile(path.join(root, 'package-lock.json'));
const packageLock = JSON.parse(packageLockBytes.toString('utf8'));
const register = await readFile(path.join(root, 'docs/dependencies.md'), 'utf8');

const expected = new Map(
  Object.entries({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }).map(([name, version]) => [name, String(version)]),
);
for (const [name, version] of expected) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`DEPENDENCY_DIRECT_RANGE_REFUSED: ${name}@${version} is not an exact version`);
  }
}

if (packageLock.lockfileVersion !== 3 || packageLock.packages?.[''] === undefined) {
  throw new Error('DEPENDENCY_LOCK_INVALID: package-lock.json must use lockfile version 3');
}

const lockedDirect = {
  ...packageLock.packages[''].dependencies,
  ...packageLock.packages[''].devDependencies,
};
if (JSON.stringify(lockedDirect) !== JSON.stringify(Object.fromEntries(expected))) {
  throw new Error('DEPENDENCY_LOCK_DIRECT_DRIFT: package.json and lockfile direct pins differ');
}

for (const [lockPath, metadata] of Object.entries(packageLock.packages)) {
  if (lockPath === '') continue;
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    typeof metadata.version !== 'string' ||
    metadata.version.length === 0 ||
    (metadata.link !== true &&
      (typeof metadata.resolved !== 'string' || typeof metadata.integrity !== 'string'))
  ) {
    throw new Error(`DEPENDENCY_LOCK_TRANSITIVE_UNPINNED: ${lockPath}`);
  }
}

const installScriptPolicy = validateInstallScriptPolicy(
  packageJson,
  collectInstallScriptPackages(packageLock),
);

const rows = /** @type {Array<[string, string, string, string, string, string, string]>} */ (
  register
    .split(/\r?\n/u)
    .filter((line) => /^\| `[^`]+`/u.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
);
/** @type {Map<string, string>} */
const observed = new Map();
/** @type {Set<string>} */
const licenses = new Set();

for (const cells of rows) {
  if (cells.length !== 7 || cells.some((cell) => cell.length === 0)) {
    throw new Error(`DEPENDENCY_REGISTER_ROW_INVALID: ${cells[0] ?? 'unknown package'}`);
  }
  const packageCell = cells[0];
  const match = /^`(.+)@([^@]+)`$/u.exec(packageCell);
  if (match === null) throw new Error(`DEPENDENCY_REGISTER_PACKAGE_INVALID: ${packageCell}`);
  const [, name, version] = /** @type {RegExpExecArray & [string, string, string]} */ (match);
  if (observed.has(name)) throw new Error(`DEPENDENCY_REGISTER_DUPLICATE: ${name}`);
  observed.set(name, version);

  const expectedVersion = expected.get(name);
  if (expectedVersion !== version) {
    throw new Error(
      `DEPENDENCY_REGISTER_VERSION_DRIFT: ${name} expected ${String(expectedVersion)}, received ${version}`,
    );
  }

  const installedMetadata = JSON.parse(
    await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (installedMetadata.version !== version || installedMetadata.license !== cells[2]) {
    throw new Error(
      `DEPENDENCY_REGISTER_METADATA_DRIFT: ${name} installed version/licence does not match the register`,
    );
  }
  licenses.add(cells[2]);
}

const missing = [...expected.keys()].filter((name) => !observed.has(name));
const stale = [...observed.keys()].filter((name) => !expected.has(name));
if (missing.length > 0 || stale.length > 0 || observed.size !== expected.size) {
  throw new Error(
    `DEPENDENCY_REGISTER_SET_DRIFT: missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}`,
  );
}

if (/registry updated|unpacked size|exact-version (?:advisory )?match/iu.test(register)) {
  throw new Error(
    'DEPENDENCY_REGISTER_UNREGENERABLE_CLAIM: remove mutable registry dates, unpacked sizes, and unsupported exact-match claims',
  );
}

const evidence = {
  schemaVersion: 1,
  command: 'npm run dependencies:check',
  seed: 20260809,
  packageLockSha256: createHash('sha256').update(packageLockBytes).digest('hex'),
  directDependenciesReviewed: observed.size,
  resolvedPackageEntries: Object.keys(packageLock.packages).length - 1,
  installScriptPolicy,
  licenses: [...licenses].sort(),
};

await mkdir(path.join(root, 'evidence'), { recursive: true });
await writeFile(
  path.join(root, 'evidence/dependency-register.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
