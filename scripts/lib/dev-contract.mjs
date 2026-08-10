import { execFile as execFileCallback } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, link, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** @typedef {'app-dev' | 'preview' | 'playwright' | 'fixtures'} ServiceName */
/** @typedef {'PORT_0' | 'PORT_1' | 'PORT_2' | 'PORT_3'} PortKey */
/** @typedef {'vite-dev' | 'vite-preview' | 'fixtures'} ServiceKind */
/**
 * @typedef {Readonly<{
 *   key: PortKey;
 *   port: number;
 *   kind: ServiceKind;
 * }>} ServiceSpec
 */
/**
 * @typedef {Readonly<{
 *   schemaVersion: 1;
 *   repository: 'neuralsprint';
 *   service: ServiceName;
 *   port: number;
 *   pid: number;
 *   ownerToken: string;
 *   root: string;
 *   startedAt: string;
 * }>} PidRecord
 */
/** @typedef {Readonly<{ pid: number; address: string }>} PortListener */

const execFile = promisify(execFileCallback);
const PROCESS_INSPECTION_OPTIONS = Object.freeze({
  encoding: 'utf8',
  killSignal: 'SIGKILL',
  maxBuffer: 1024 * 1024,
  timeout: 5_000,
});

export const REPOSITORY = 'neuralsprint';
export const LOOPBACK_HOST = '127.0.0.1';
export const READY_PATH = '/__neuralsprint/ready';
export const LIVE_PATH = '/__neuralsprint/live';
export const CONTROL_IDENTITY_PATH = '/__neuralsprint/control/identity';
export const CONTROL_SHUTDOWN_PATH = '/__neuralsprint/control/shutdown';
export const PID_SCHEMA_VERSION = 1;

export const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const DEV_ROOT = path.join(REPOSITORY_ROOT, '.dev');
export const PID_ROOT = path.join(DEV_ROOT, 'pids');
export const LOG_ROOT = path.join(DEV_ROOT, 'logs');
export const TMP_ROOT = path.join(DEV_ROOT, 'tmp');
export const CACHE_ROOT = path.join(DEV_ROOT, 'cache');
export const TYPESCRIPT_CACHE_ROOT = path.join(CACHE_ROOT, 'typescript');
export const PLAYWRIGHT_PROFILE_ROOT = path.join(DEV_ROOT, 'pw-profile');
export const PORTS_FILE = path.join(REPOSITORY_ROOT, 'ports.env');
export const SERVICE_ENTRY = path.join(REPOSITORY_ROOT, 'scripts', 'dev-service.mjs');

export const SERVICE_SPECS = Object.freeze({
  'app-dev': Object.freeze({ key: 'PORT_0', port: 4210, kind: 'vite-dev' }),
  preview: Object.freeze({ key: 'PORT_1', port: 4211, kind: 'vite-preview' }),
  playwright: Object.freeze({ key: 'PORT_2', port: 4212, kind: 'vite-dev' }),
  fixtures: Object.freeze({ key: 'PORT_3', port: 4213, kind: 'fixtures' }),
});

export const SERVICE_NAMES = Object.freeze(
  /** @type {ServiceName[]} */ (Object.keys(SERVICE_SPECS)),
);

export class DevContractError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = 'DevContractError';
    this.code = code;
    this.details = details;
  }
}

export function createOwnerToken() {
  return randomBytes(32).toString('hex');
}

/**
 * @param {unknown} token
 * @returns {token is string}
 */
export function validateOwnerToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/u.test(token);
}

/**
 * @param {unknown} service
 * @returns {ServiceSpec}
 */
export function serviceSpec(service) {
  const spec = SERVICE_SPECS[/** @type {ServiceName} */ (service)];
  if (spec === undefined) {
    throw new DevContractError('DEV_SERVICE_UNKNOWN', `Unknown service ${String(service)}`);
  }
  return spec;
}

/** @returns {Promise<Readonly<Record<PortKey, number>>>} */
export async function loadAndValidatePorts() {
  const contents = await readFile(PORTS_FILE, 'utf8');
  /** @type {Map<PortKey, number>} */
  const parsed = new Map();

  for (const [index, sourceLine] of contents.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const match = /^(PORT_[0-3])=(\d+)(?:\s+#.*)?$/u.exec(line);
    if (match === null) {
      throw new DevContractError(
        'DEV_PORT_CONFIG_INVALID',
        `ports.env line ${index + 1} is not a supported assignment`,
      );
    }

    const key = /** @type {PortKey} */ (match[1]);
    const rawPort = /** @type {string} */ (match[2]);
    if (parsed.has(key)) {
      throw new DevContractError('DEV_PORT_CONFIG_INVALID', `${key} is declared more than once`);
    }
    parsed.set(key, Number(rawPort));
  }

  /** @type {Set<number>} */
  const seenPorts = new Set();
  for (const service of SERVICE_NAMES) {
    const spec = serviceSpec(service);
    const configuredPort = parsed.get(spec.key);
    if (configuredPort !== spec.port) {
      throw new DevContractError(
        'DEV_PORT_CONFIG_INVALID',
        `${spec.key} must be exactly ${spec.port}; received ${String(configuredPort)}`,
      );
    }
    if (configuredPort < 4210 || configuredPort > 4219 || seenPorts.has(configuredPort)) {
      throw new DevContractError(
        'DEV_PORT_CONFIG_INVALID',
        `${spec.key} is outside the exclusive block or duplicates another service`,
      );
    }
    seenPorts.add(configuredPort);
  }

  if (parsed.size !== SERVICE_NAMES.length) {
    throw new DevContractError(
      'DEV_PORT_CONFIG_INVALID',
      'ports.env must declare PORT_0 through PORT_3',
    );
  }

  return /** @type {Readonly<Record<PortKey, number>>} */ (
    Object.freeze(Object.fromEntries(parsed))
  );
}

/** @param {string} directory */
async function ensureDirectory(directory) {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DevContractError(
        'DEV_DIRECTORY_UNSAFE',
        `${directory} must be a real directory, not a symlink`,
      );
    }
  } catch (error) {
    if (error instanceof DevContractError) throw error;
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') throw error;
    await mkdir(directory, { mode: 0o700 });
  }
}

/** @returns {Promise<void>} */
export async function ensureRuntimeDirectories() {
  await ensureDirectory(DEV_ROOT);
  for (const directory of [
    PID_ROOT,
    LOG_ROOT,
    TMP_ROOT,
    CACHE_ROOT,
    TYPESCRIPT_CACHE_ROOT,
    PLAYWRIGHT_PROFILE_ROOT,
  ]) {
    await ensureDirectory(directory);
  }
}

/** @param {ServiceName} service */
export function pidFileFor(service) {
  serviceSpec(service);
  return path.join(PID_ROOT, `${service}.json`);
}

/** @param {ServiceName} service */
export function logFileFor(service) {
  serviceSpec(service);
  return path.join(LOG_ROOT, `${service}.log`);
}

/**
 * @param {unknown} value
 * @param {ServiceName} [expectedService]
 * @returns {PidRecord}
 */
export function validatePidRecord(value, expectedService = undefined) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DevContractError('DEV_PID_INVALID', 'PID record must be a JSON object');
  }

  const candidate = /** @type {Record<string, unknown>} */ (value);
  const service = candidate.service;
  const spec = serviceSpec(service);
  if (
    candidate.schemaVersion !== PID_SCHEMA_VERSION ||
    candidate.repository !== REPOSITORY ||
    candidate.root !== REPOSITORY_ROOT ||
    candidate.port !== spec.port ||
    !Number.isSafeInteger(candidate.pid) ||
    /** @type {number} */ (candidate.pid) <= 1 ||
    !validateOwnerToken(candidate.ownerToken) ||
    typeof candidate.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.startedAt))
  ) {
    throw new DevContractError('DEV_PID_INVALID', `PID record for ${String(service)} is invalid`);
  }

  if (expectedService !== undefined && service !== expectedService) {
    throw new DevContractError(
      'DEV_PID_INVALID',
      `Expected a ${expectedService} PID record, received ${String(service)}`,
    );
  }

  return /** @type {PidRecord} */ (
    Object.freeze({
      schemaVersion: candidate.schemaVersion,
      repository: candidate.repository,
      service,
      port: candidate.port,
      pid: candidate.pid,
      ownerToken: candidate.ownerToken,
      root: candidate.root,
      startedAt: candidate.startedAt,
    })
  );
}

/**
 * @param {ServiceName} service
 * @returns {Promise<PidRecord | undefined>}
 */
export async function readPidRecord(service) {
  const file = pidFileFor(service);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new DevContractError('DEV_PID_INVALID', `${file} must be a regular file`);
    }
    return validatePidRecord(JSON.parse(await readFile(file, 'utf8')), service);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) {
      throw new DevContractError('DEV_PID_INVALID', `${file} is not valid JSON`);
    }
    throw error;
  }
}

/**
 * @param {PidRecord} record
 * @returns {Promise<void>}
 */
export async function writePidRecord(record) {
  const validated = validatePidRecord(record, record.service);
  const destination = pidFileFor(validated.service);
  const temporary = `${destination}.${process.pid}.${createOwnerToken()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * @param {PidRecord} record
 * @returns {Promise<void>}
 */
export async function removePidRecordIfOwned(record) {
  const current = await readPidRecord(record.service);
  if (
    current !== undefined &&
    current.pid === record.pid &&
    current.ownerToken === record.ownerToken
  ) {
    await rm(pidFileFor(record.service), { force: true });
  }
}

/** @param {number} pid */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error)?.code === 'EPERM';
  }
}

/**
 * @param {number} pid
 * @returns {Promise<string>}
 */
export async function processCommand(pid) {
  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      'if ($null -ne $p) { $p.CommandLine }',
    ].join('; ');
    const { stdout } = await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      PROCESS_INSPECTION_OPTIONS,
    );
    return stdout.trim();
  }

  const { stdout } = await execFile(
    'ps',
    ['-ww', '-p', String(pid), '-o', 'command='],
    PROCESS_INSPECTION_OPTIONS,
  );
  return stdout.trim();
}

/**
 * @param {unknown} command
 * @param {PidRecord} record
 */
export function commandMatchesPidRecord(command, record) {
  const tokenFragment = `--owner-token ${record.ownerToken}`;
  return (
    typeof command === 'string' &&
    command.includes(SERVICE_ENTRY) &&
    command.includes(`--service ${record.service}`) &&
    command.includes(`--port ${record.port}`) &&
    command.includes(tokenFragment)
  );
}

/**
 * @param {number} port
 * @returns {Promise<PortListener[]>}
 */
export async function listPortListeners(port) {
  if (process.platform === 'win32') {
    const script = [
      `$items = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue)`,
      '$items | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress',
    ].join('; ');
    const { stdout } = await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      PROCESS_INSPECTION_OPTIONS,
    );
    if (stdout.trim().length === 0) return [];
    const decoded = /** @type {unknown} */ (JSON.parse(stdout));
    const rows = Array.isArray(decoded) ? decoded : [decoded];
    return rows.map((row) => {
      const candidate = /** @type {Record<string, unknown>} */ (row);
      return {
        pid: Number(candidate.OwningProcess),
        address: `${String(candidate.LocalAddress)}:${String(candidate.LocalPort)}`,
      };
    });
  }

  try {
    const { stdout } = await execFile(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'],
      PROCESS_INSPECTION_OPTIONS,
    );
    /** @type {PortListener[]} */
    const listeners = [];
    /** @type {number | undefined} */
    let currentPid;
    for (const line of stdout.split(/\r?\n/u)) {
      if (line.startsWith('p')) currentPid = Number(line.slice(1));
      if (line.startsWith('n') && Number.isSafeInteger(currentPid)) {
        listeners.push({ pid: /** @type {number} */ (currentPid), address: line.slice(1) });
      }
    }
    return listeners;
  } catch (error) {
    const errorCode = /** @type {{ code?: string | number } | null | undefined} */ (error)?.code;
    if (errorCode === 1) return [];
    if (errorCode === 'ENOENT') {
      throw new DevContractError(
        'DEV_PROCESS_INSPECTOR_MISSING',
        'lsof is required to prove listener ownership',
      );
    }
    throw error;
  }
}

/**
 * @param {PortListener} listener
 * @param {number} port
 */
export function isExactLoopbackListener(listener, port) {
  return listener.address === `${LOOPBACK_HOST}:${port}`;
}

/** @param {PidRecord} record */
export async function isTrustedPidRecord(record) {
  if (!isProcessAlive(record.pid)) return false;
  try {
    return commandMatchesPidRecord(await processCommand(record.pid), record);
  } catch {
    return false;
  }
}

/** @returns {Promise<string>} */
export async function canonicalRepositoryRoot() {
  return realpath(REPOSITORY_ROOT);
}
