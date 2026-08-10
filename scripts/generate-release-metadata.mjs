import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runBoundedChild } from './lib/bounded-child.mjs';
import {
  CACHE_ROOT,
  REPOSITORY_ROOT,
  TMP_ROOT,
  ensureRuntimeDirectories,
} from './lib/dev-contract.mjs';

const root = REPOSITORY_ROOT;
const evidenceRoot = path.join(root, 'evidence');
const distRoot = path.join(root, 'dist');

/** @typedef {{ stdout: Buffer, stderr: Buffer }} CapturedChildResult */

/**
 * @param {import('node:crypto').BinaryLike} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @returns {Promise<Buffer>}
 */
async function capture(command, args) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    npm_config_cache: path.join(CACHE_ROOT, 'npm'),
    TMPDIR: TMP_ROOT,
    TMP: TMP_ROOT,
    TEMP: TMP_ROOT,
  };
  if (environment.NO_COLOR !== undefined) delete environment.FORCE_COLOR;
  const result = /** @type {CapturedChildResult} */ (
    await runBoundedChild({
      command,
      args,
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: 'capture',
      timeoutMs: 60_000,
      maximumOutputBytes: 8 * 1024 * 1024,
    })
  );
  if (result.stderr.byteLength > 0) {
    process.stderr.write(result.stderr);
    throw new Error(`RELEASE_METADATA_STDERR_REFUSED: ${command} emitted diagnostics`);
  }
  return result.stdout;
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`RELEASE_SYMLINK_REFUSED: ${absolute}`);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

/**
 * @param {string} hash
 * @returns {string}
 */
function deterministicUuid(hash) {
  const characters = hash.slice(0, 32).split('');
  characters[12] = '5';
  characters[16] = /** @type {string} */ (
    ['8', '9', 'a', 'b'][Number.parseInt(/** @type {string} */ (characters[16]), 16) % 4]
  );
  const value = characters.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

await ensureRuntimeDirectories();
const lockBytes = await readFile(path.join(root, 'package-lock.json'));
const lockSha256 = sha256(lockBytes);
const rawSbom = JSON.parse(
  (await capture('npm', ['sbom', '--omit=dev', '--sbom-format', 'cyclonedx'])).toString('utf8'),
);

const distMetadata = await lstat(distRoot);
if (!distMetadata.isDirectory() || distMetadata.isSymbolicLink()) {
  throw new Error('RELEASE_DIST_UNSAFE: dist must be a real directory');
}

delete rawSbom.serialNumber;
if (rawSbom.metadata !== null && typeof rawSbom.metadata === 'object') {
  delete rawSbom.metadata.timestamp;
  rawSbom.metadata.properties = [
    ...(Array.isArray(rawSbom.metadata.properties) ? rawSbom.metadata.properties : []),
    { name: 'neuralsprint:evidence:command', value: 'npm run release:metadata' },
    { name: 'neuralsprint:evidence:seed', value: '20260809' },
  ];
}
const sbomIdentitySha256 = sha256(Buffer.from(JSON.stringify(rawSbom), 'utf8'));
rawSbom.serialNumber = `urn:uuid:${deterministicUuid(sbomIdentitySha256)}`;
const sbomBytes = Buffer.from(`${JSON.stringify(rawSbom, null, 2)}\n`, 'utf8');

const artifacts = [];
for (const file of (await walk(distRoot)).sort()) {
  const bytes = await readFile(file);
  const metadata = await stat(file);
  artifacts.push({
    path: path.relative(root, file).split(path.sep).join('/'),
    bytes: metadata.size,
    sha256: sha256(bytes),
  });
}

if (artifacts.length === 0) throw new Error('RELEASE_ARTIFACTS_EMPTY: dist contains no files');

const manifest = {
  schemaVersion: 1,
  command: 'npm run release:metadata',
  seed: 20260809,
  packageLockSha256: lockSha256,
  sbomSha256: sha256(sbomBytes),
  artifacts,
};

await mkdir(evidenceRoot, { recursive: true });
await Promise.all([
  writeFile(path.join(evidenceRoot, 'sbom.cdx.json'), sbomBytes),
  writeFile(
    path.join(evidenceRoot, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
]);

process.stdout.write(
  `release metadata generated: artifacts=${artifacts.length} lock=${lockSha256}\n`,
);
