import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DevContractError, TMP_ROOT } from './dev-contract.mjs';

/**
 * @typedef {Partial<Record<'id' | 'file' | 'sha256' | 'bytes' | 'expectedFindings', unknown>>} RawFixture
 * @typedef {Partial<Record<'schemaVersion' | 'corpus' | 'fixtures', unknown>>} RawFixtureManifest
 * @typedef {Readonly<{
 *   id: string,
 *   file: string,
 *   sha256: string,
 *   bytes: number,
 *   expectedFindings: readonly string[],
 * }>} FixtureManifestEntry
 * @typedef {Readonly<{
 *   schemaVersion: 1,
 *   corpus: 'neuralsprint-adversarial-smoke',
 *   fixtures: readonly FixtureManifestEntry[],
 * }>} FixtureManifest
 * @typedef {Readonly<{
 *   manifest: FixtureManifest,
 *   manifestBytes: Buffer,
 *   fixtureBytes: Map<string, Buffer>,
 * }>} VerifiedFixtureCorpus
 */

export const FIXTURE_CORPUS_ROOT = path.join(TMP_ROOT, 'fixture-corpus');
export const FIXTURE_MANIFEST_PATH = path.join(FIXTURE_CORPUS_ROOT, 'manifest.json');
export const SMOKE_FIXTURE_FILE = 'covered-text-smoke.pdf';
export const SMOKE_FIXTURE_ID = 'covered-text-smoke-v1';

/**
 * @param {number} number
 * @param {string} body
 * @returns {string}
 */
function pdfObject(number, body) {
  return `${number} 0 obj\n${body}\nendobj\n`;
}

/** @returns {Buffer} */
export function buildCoveredTextSmokePdf() {
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 700 Td',
    '(SYNTHETIC TOKEN 000-00-0000) Tj',
    'ET',
    '0 0 0 rg',
    '70 688 310 28 re',
    'f',
    '',
  ].join('\n');

  const objects = [
    pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
    pdfObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    pdfObject(
      3,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    ),
    pdfObject(4, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`),
    pdfObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];

  const header = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const chunks = [header];
  const offsets = [0];
  let offset = Buffer.byteLength(header, 'binary');

  for (const object of objects) {
    offsets.push(offset);
    chunks.push(object);
    offset += Buffer.byteLength(object, 'binary');
  }

  const xrefOffset = offset;
  const xrefRows = ['0000000000 65535 f '];
  for (const objectOffset of offsets.slice(1)) {
    xrefRows.push(`${String(objectOffset).padStart(10, '0')} 00000 n `);
  }
  chunks.push(
    `xref\n0 ${objects.length + 1}\n${xrefRows.join('\n')}\n` +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.from(chunks.join(''), 'binary');
}

/**
 * @param {import('node:crypto').BinaryLike} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {RawFixtureManifest | null} value
 * @returns {FixtureManifest}
 */
export function validateFixtureManifest(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.corpus !== 'neuralsprint-adversarial-smoke' ||
    !Array.isArray(value.fixtures) ||
    value.fixtures.length < 1
  ) {
    throw new DevContractError('DEV_FIXTURE_MANIFEST_INVALID', 'Fixture manifest shape is invalid');
  }

  const fixtures = value.fixtures.map(
    /** @param {RawFixture | null} fixture */ (fixture) => {
      if (
        fixture === null ||
        typeof fixture !== 'object' ||
        Array.isArray(fixture) ||
        typeof fixture.id !== 'string' ||
        !/^[a-z0-9-]+$/u.test(fixture.id) ||
        typeof fixture.file !== 'string' ||
        path.basename(fixture.file) !== fixture.file ||
        !fixture.file.endsWith('.pdf') ||
        typeof fixture.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(fixture.sha256) ||
        !Number.isSafeInteger(fixture.bytes) ||
        /** @type {number} */ (fixture.bytes) <= 0 ||
        !Array.isArray(fixture.expectedFindings) ||
        fixture.expectedFindings.length < 1 ||
        !fixture.expectedFindings.every(
          /** @param {unknown} finding */ (finding) => typeof finding === 'string',
        )
      ) {
        throw new DevContractError(
          'DEV_FIXTURE_MANIFEST_INVALID',
          'Fixture manifest contains an invalid entry',
        );
      }
      return Object.freeze({
        id: fixture.id,
        file: fixture.file,
        sha256: fixture.sha256,
        bytes: /** @type {number} */ (fixture.bytes),
        expectedFindings: Object.freeze([...fixture.expectedFindings]),
      });
    },
  );

  return Object.freeze({
    schemaVersion: 1,
    corpus: value.corpus,
    fixtures: Object.freeze(fixtures),
  });
}

/**
 * @param {string} root
 * @param {{ create: boolean }} options
 * @returns {Promise<string>}
 */
async function ensureSafeCorpusRoot(root, { create }) {
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(TMP_ROOT) ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(path.basename(resolved))
  ) {
    throw new DevContractError(
      'DEV_FIXTURE_ROOT_INVALID',
      'Fixture corpus must be a direct, named child of the repository temporary root',
    );
  }

  const temporaryRoot = await lstat(TMP_ROOT).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new DevContractError(
        'DEV_FIXTURE_ROOT_MISSING',
        'Repository runtime directories must exist before fixture generation',
      );
    }
    throw error;
  });
  if (!temporaryRoot.isDirectory() || temporaryRoot.isSymbolicLink()) {
    throw new DevContractError(
      'DEV_FIXTURE_ROOT_INVALID',
      'Repository temporary root must be a real directory',
    );
  }

  try {
    const metadata = await lstat(resolved);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DevContractError(
        'DEV_FIXTURE_ROOT_INVALID',
        'Fixture corpus root must be a real directory',
      );
    }
  } catch (error) {
    if (error instanceof DevContractError) throw error;
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT' || !create) throw error;
    await mkdir(resolved, { mode: 0o700 });
  }
  return resolved;
}

/**
 * @param {string} destination
 * @param {string | Uint8Array} bytes
 * @returns {Promise<void>}
 */
async function writeAtomically(destination, bytes) {
  const temporary = `${destination}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * @param {string} file
 * @param {string} code
 * @param {string} description
 * @returns {Promise<Buffer>}
 */
async function readStableRegularFile(file, code, description) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new DevContractError(code, `${description} must be a regular file`);
  }

  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new DevContractError(code, `${description} changed during verification`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} [root]
 * @returns {Promise<FixtureManifest>}
 */
export async function generateFixtureCorpus(root = FIXTURE_CORPUS_ROOT) {
  const safeRoot = await ensureSafeCorpusRoot(root, { create: true });
  const pdf = buildCoveredTextSmokePdf();
  const manifest = validateFixtureManifest({
    schemaVersion: 1,
    corpus: 'neuralsprint-adversarial-smoke',
    fixtures: [
      {
        id: SMOKE_FIXTURE_ID,
        file: SMOKE_FIXTURE_FILE,
        sha256: sha256Hex(pdf),
        bytes: pdf.byteLength,
        expectedFindings: ['covered-selectable-text'],
      },
    ],
  });

  await writeAtomically(path.join(safeRoot, SMOKE_FIXTURE_FILE), pdf);
  await writeAtomically(
    path.join(safeRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/**
 * @param {string} [root]
 * @returns {Promise<VerifiedFixtureCorpus>}
 */
export async function loadVerifiedFixtureCorpus(root = FIXTURE_CORPUS_ROOT) {
  const safeRoot = await ensureSafeCorpusRoot(root, { create: false });
  let manifest;
  let manifestBytes;
  try {
    const manifestPath = path.join(safeRoot, 'manifest.json');
    manifestBytes = await readStableRegularFile(
      manifestPath,
      'DEV_FIXTURE_MANIFEST_INVALID',
      'Fixture manifest',
    );
    manifest = validateFixtureManifest(JSON.parse(manifestBytes.toString('utf8')));
  } catch (error) {
    if (error instanceof DevContractError) throw error;
    throw new DevContractError(
      'DEV_FIXTURE_MANIFEST_INVALID',
      'Fixture manifest cannot be decoded',
    );
  }

  const fixtureBytes = new Map();
  for (const fixture of manifest.fixtures) {
    const file = path.resolve(safeRoot, fixture.file);
    if (path.dirname(file) !== safeRoot) {
      throw new DevContractError(
        'DEV_FIXTURE_PATH_INVALID',
        `Fixture ${fixture.id} escapes the corpus root`,
      );
    }
    const bytes = await readStableRegularFile(
      file,
      'DEV_FIXTURE_BYTES_INVALID',
      `Fixture ${fixture.id}`,
    );
    if (
      bytes.byteLength !== fixture.bytes ||
      sha256Hex(bytes) !== fixture.sha256 ||
      !bytes.subarray(0, 8).toString('binary').startsWith('%PDF-1.') ||
      !bytes.subarray(-32).toString('binary').includes('%%EOF')
    ) {
      throw new DevContractError(
        'DEV_FIXTURE_BYTES_INVALID',
        `Fixture ${fixture.id} does not match its manifest`,
      );
    }
    fixtureBytes.set(fixture.file, bytes);
  }

  return Object.freeze({ manifest, manifestBytes, fixtureBytes });
}

/**
 * @param {string} [root]
 * @returns {Promise<FixtureManifest>}
 */
export async function verifyFixtureCorpus(root = FIXTURE_CORPUS_ROOT) {
  return (await loadVerifiedFixtureCorpus(root)).manifest;
}

/**
 * @param {string} [root]
 * @returns {Promise<void>}
 */
export async function removeFixtureCorpus(root = FIXTURE_CORPUS_ROOT) {
  let safeRoot;
  try {
    safeRoot = await ensureSafeCorpusRoot(root, { create: false });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
    throw error;
  }
  await rm(safeRoot, { recursive: true, force: true });
}
