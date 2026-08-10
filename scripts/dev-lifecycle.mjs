#!/usr/bin/env node

import { spawn, execFile as execFileCallback } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { link, lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  CONTROL_SHUTDOWN_PATH,
  DevContractError,
  LOOPBACK_HOST,
  PID_SCHEMA_VERSION,
  REPOSITORY,
  REPOSITORY_ROOT,
  SERVICE_ENTRY,
  SERVICE_NAMES,
  TMP_ROOT,
  canonicalRepositoryRoot,
  commandMatchesPidRecord,
  createOwnerToken,
  ensureRuntimeDirectories,
  isExactLoopbackListener,
  isProcessAlive,
  listPortListeners,
  loadAndValidatePorts,
  logFileFor,
  processCommand,
  readPidRecord,
  removePidRecordIfOwned,
  serviceSpec,
  validateOwnerToken,
} from './lib/dev-contract.mjs';
import { probeServiceHealth } from './lib/readiness-probes.mjs';
import { runProductionBuild } from './lib/production-build.mjs';

/** @typedef {'app-dev' | 'preview' | 'playwright' | 'fixtures'} ServiceName */
/** @typedef {Exclude<Awaited<ReturnType<typeof readPidRecord>>, undefined>} PidRecord */
/** @typedef {Awaited<ReturnType<typeof listPortListeners>>[number]} PortListener */
/**
 * @typedef {Readonly<{
 *   schemaVersion: 1;
 *   pid: number;
 *   token: string;
 *   startedAt: string;
 * }>} ControlLockOwner
 */
/** @typedef {Readonly<{ token: string }>} ControlLock */
/**
 * @typedef {
 *   | 'free'
 *   | 'foreign'
 *   | 'untrusted-pid-record'
 *   | 'owned-misbound'
 *   | 'owned-unhealthy'
 *   | 'owned-healthy'
 * } InspectionStateName
 */
/**
 * @typedef {Readonly<{
 *   service: string;
 *   port: number;
 *   state: InspectionStateName;
 *   listeners: readonly PortListener[];
 *   record?: PidRecord;
 *   note?: string;
 *   error?: string;
 * }>} InspectionState
 */
/** @typedef {InspectionState & { service: ServiceName }} ServiceInspectionState */

const execFile = promisify(execFileCallback);
const CONTROL_LOCK = path.join(TMP_ROOT, 'dev-lifecycle.lock');
const HEALTH_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 90_000;

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), milliseconds));
}

/** @param {unknown} error */
function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error */
function errorCode(error) {
  return /** @type {{ code?: string | number } | null | undefined} */ (error)?.code;
}

/** @returns {Promise<ControlLock>} */
async function acquireControlLock() {
  const token = createOwnerToken();
  const owner = Object.freeze({
    schemaVersion: 1,
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  });
  const deadline = Date.now() + 5_000;
  while (true) {
    if (await tryCreateControlLock(owner)) {
      return Object.freeze({ token });
    }

    const currentOwner = await readControlLockOwner();
    if (currentOwner === undefined) continue;
    if (isProcessAlive(currentOwner.pid)) {
      if (Date.now() >= deadline) {
        throw new DevContractError(
          'DEV_LIFECYCLE_LOCKED',
          `Lifecycle operation ${currentOwner.pid} still owns the control lock`,
        );
      }
      await delay(100);
      continue;
    }
    await removeControlLockIfOwned(currentOwner);
  }
}

/** @param {string} file */
async function unlinkIfPresent(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

/**
 * @param {ControlLockOwner} owner
 * @returns {Promise<boolean>}
 */
async function tryCreateControlLock(owner) {
  const candidate = `${CONTROL_LOCK}.${process.pid}.${owner.token}.candidate`;
  await writeFile(candidate, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await link(candidate, CONTROL_LOCK);
  } catch (error) {
    try {
      await unlinkIfPresent(candidate);
    } catch (cleanupError) {
      const aggregate = new DevContractError(
        'DEV_LIFECYCLE_LOCK_CANDIDATE_CLEANUP_FAILED',
        `Lock acquisition failed with ${safeMessage(error)}; candidate cleanup failed with ${safeMessage(cleanupError)}`,
      );
      aggregate.cause = new AggregateError([error, cleanupError]);
      throw aggregate;
    }
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }

  try {
    await unlinkIfPresent(candidate);
  } catch (cleanupError) {
    let releaseError;
    try {
      await removeControlLockIfOwned(owner);
    } catch (error) {
      releaseError = error;
    }
    const aggregate = new DevContractError(
      'DEV_LIFECYCLE_LOCK_CANDIDATE_CLEANUP_FAILED',
      `The lifecycle lock was acquired but candidate cleanup failed: ${safeMessage(cleanupError)}${releaseError === undefined ? '' : `; lock release also failed: ${safeMessage(releaseError)}`}`,
    );
    aggregate.cause = new AggregateError(
      releaseError === undefined ? [cleanupError] : [cleanupError, releaseError],
    );
    throw aggregate;
  }
  return true;
}

/** @returns {Promise<ControlLockOwner | undefined>} */
async function readControlLockOwner() {
  let metadata;
  try {
    metadata = await lstat(CONTROL_LOCK);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DevContractError(
      'DEV_LIFECYCLE_LOCK_INVALID',
      'The lifecycle control lock must be a regular file',
    );
  }

  let owner;
  try {
    owner = JSON.parse(await readFile(CONTROL_LOCK, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw new DevContractError(
      'DEV_LIFECYCLE_LOCK_INVALID',
      `The lifecycle control lock owner cannot be decoded: ${safeMessage(error)}`,
    );
  }
  if (
    owner === null ||
    typeof owner !== 'object' ||
    owner.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 1 ||
    !validateOwnerToken(owner.token) ||
    typeof owner.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(owner.startedAt))
  ) {
    throw new DevContractError(
      'DEV_LIFECYCLE_LOCK_INVALID',
      'The lifecycle control lock owner record is malformed; refusing unsafe removal',
    );
  }
  return /** @type {ControlLockOwner} */ (owner);
}

/** @param {Pick<ControlLockOwner, 'pid' | 'token'>} expectedOwner */
async function removeControlLockIfOwned(expectedOwner) {
  const currentOwner = await readControlLockOwner();
  if (currentOwner === undefined) return false;
  if (currentOwner.pid !== expectedOwner.pid || currentOwner.token !== expectedOwner.token) {
    return false;
  }
  await unlink(CONTROL_LOCK);
  return true;
}

/** @param {ControlLock} lock */
async function releaseControlLock(lock) {
  await removeControlLockIfOwned({ pid: process.pid, token: lock.token });
}

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withControlLock(operation) {
  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let operationError;
  await ensureRuntimeDirectories();
  const lock = await acquireControlLock();
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  /** @type {unknown} */
  let releaseError;
  try {
    await releaseControlLock(lock);
  } catch (error) {
    releaseError = error;
  }
  if (operationError !== undefined && releaseError !== undefined) {
    const aggregate = new DevContractError(
      'DEV_LIFECYCLE_OPERATION_AND_RELEASE_FAILED',
      `Lifecycle operation failed with ${safeMessage(operationError)}; lock release failed with ${safeMessage(releaseError)}`,
    );
    aggregate.cause = new AggregateError([operationError, releaseError]);
    throw aggregate;
  }
  if (operationError !== undefined) throw operationError;
  if (releaseError !== undefined) throw releaseError;
  return /** @type {T} */ (result);
}

async function verifyGitIgnore() {
  try {
    await execFile(
      'git',
      [
        '-C',
        REPOSITORY_ROOT,
        'check-ignore',
        '--quiet',
        '--no-index',
        '.dev/pids/__preflight_probe__',
      ],
      { encoding: 'utf8', killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, timeout: 5_000 },
    );
  } catch (error) {
    if (errorCode(error) !== 1) {
      throw new DevContractError(
        'DEV_GIT_IGNORE_CHECK_FAILED',
        `git check-ignore could not complete: ${safeMessage(error)}`,
      );
    }
    throw new DevContractError(
      'DEV_DIRECTORY_NOT_IGNORED',
      '.dev must be ignored by the repository root .gitignore',
    );
  }
}

/**
 * @param {ServiceName} service
 * @param {{ cleanDeadRecord: boolean }} options
 * @returns {Promise<ServiceInspectionState>}
 */
async function inspectService(service, { cleanDeadRecord }) {
  const spec = serviceSpec(service);
  const listeners = await listPortListeners(spec.port);
  let record;
  try {
    record = await readPidRecord(service);
  } catch (error) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'untrusted-pid-record',
      listeners,
      error: safeMessage(error),
    });
  }

  if (record === undefined) {
    return Object.freeze({
      service,
      port: spec.port,
      state: listeners.length === 0 ? 'free' : 'foreign',
      listeners,
    });
  }

  if (!isProcessAlive(record.pid)) {
    if (cleanDeadRecord) await removePidRecordIfOwned(record);
    return Object.freeze({
      service,
      port: spec.port,
      state: listeners.length === 0 ? 'free' : 'foreign',
      listeners,
      note: 'removed-dead-pid-record',
    });
  }

  let command;
  try {
    command = await processCommand(record.pid);
  } catch (error) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'untrusted-pid-record',
      listeners,
      error: safeMessage(error),
    });
  }

  if (!commandMatchesPidRecord(command, record)) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'untrusted-pid-record',
      listeners,
      error: 'PID command fingerprint does not match its owner token',
    });
  }

  const ownListeners = listeners.filter((listener) => listener.pid === record.pid);
  const foreignListeners = listeners.filter((listener) => listener.pid !== record.pid);
  if (foreignListeners.length > 0) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'foreign',
      listeners,
      record,
    });
  }
  if (
    ownListeners.some((listener) => !isExactLoopbackListener(listener, spec.port)) ||
    ownListeners.length > 1
  ) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'owned-misbound',
      listeners,
      record,
    });
  }
  if (ownListeners.length === 0) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'owned-unhealthy',
      listeners,
      record,
      error: 'Owned process is not listening on its assigned port',
    });
  }

  try {
    await probeServiceHealth(service);
    return Object.freeze({
      service,
      port: spec.port,
      state: 'owned-healthy',
      listeners,
      record,
    });
  } catch (error) {
    return Object.freeze({
      service,
      port: spec.port,
      state: 'owned-unhealthy',
      listeners,
      record,
      error: safeMessage(error),
    });
  }
}

/** @param {readonly InspectionState[]} states */
function printInspection(states) {
  for (const state of states) {
    const details = state.listeners
      .map((listener) => `${listener.pid}@${listener.address}`)
      .join(',');
    process.stdout.write(
      `${JSON.stringify({
        event: 'dev.preflight.port',
        service: state.service,
        host: LOOPBACK_HOST,
        port: state.port,
        state: state.state,
        listeners: details || undefined,
        note: state.note,
        error: state.error,
      })}\n`,
    );
  }
}

async function preflightImplementation() {
  const root = await canonicalRepositoryRoot();
  if (root !== REPOSITORY_ROOT) {
    throw new DevContractError(
      'DEV_REPOSITORY_ROOT_INVALID',
      `Expected repository root ${REPOSITORY_ROOT}, received ${root}`,
    );
  }
  await loadAndValidatePorts();
  await verifyGitIgnore();
  /** @type {InspectionState[]} */
  const states = await Promise.all(
    SERVICE_NAMES.map((service) => inspectService(service, { cleanDeadRecord: true })),
  );
  states.push(
    ...(await Promise.all(
      [4214, 4215, 4216, 4217, 4218, 4219].map(async (port) => {
        const listeners = await listPortListeners(port);
        return Object.freeze({
          service: `reserved-${port}`,
          port,
          state: listeners.length === 0 ? 'free' : 'foreign',
          listeners,
          note: 'reserved-unallocated',
        });
      }),
    )),
  );
  printInspection(states);
  const invalid = states.filter((state) =>
    ['foreign', 'owned-misbound', 'untrusted-pid-record'].includes(state.state),
  );
  if (invalid.length > 0) {
    throw new DevContractError(
      'DEV_PREFLIGHT_FAILED',
      `Unsafe listener state for ${invalid.map((state) => state.service).join(', ')}`,
    );
  }
  return states;
}

/**
 * @param {number} pid
 * @param {number} timeoutMs
 */
async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) await delay(50);
  return !isProcessAlive(pid);
}

/** @param {PidRecord} record */
async function stillTrusted(record) {
  if (!isProcessAlive(record.pid)) return false;
  try {
    return commandMatchesPidRecord(await processCommand(record.pid), record);
  } catch {
    return false;
  }
}

/** @param {PidRecord} record */
async function requestAuthenticatedShutdown(record) {
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${record.port}${CONTROL_SHUTDOWN_PATH}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'X-Neuralsprint-Owner-Token': record.ownerToken },
      signal: AbortSignal.timeout(1_000),
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

/** @param {PidRecord} record */
async function stopOwnedRecord(record) {
  if (!isProcessAlive(record.pid)) {
    await removePidRecordIfOwned(record);
    return;
  }
  if (!(await stillTrusted(record))) {
    throw new DevContractError(
      'DEV_PID_UNTRUSTED',
      `Refusing to signal PID ${record.pid}; its owner token fingerprint does not match`,
    );
  }

  await requestAuthenticatedShutdown(record);
  if (await waitForExit(record.pid, 2_500)) {
    await removePidRecordIfOwned(record);
    return;
  }

  if (!(await stillTrusted(record))) {
    throw new DevContractError(
      'DEV_PID_UNTRUSTED',
      `Refusing to signal PID ${record.pid}; ownership changed before SIGTERM`,
    );
  }
  process.kill(record.pid, 'SIGTERM');
  if (await waitForExit(record.pid, 4_000)) {
    await removePidRecordIfOwned(record);
    return;
  }

  if (!(await stillTrusted(record))) {
    throw new DevContractError(
      'DEV_PID_UNTRUSTED',
      `Refusing to signal PID ${record.pid}; ownership changed before forced stop`,
    );
  }
  process.kill(record.pid, 'SIGKILL');
  if (!(await waitForExit(record.pid, 2_000))) {
    throw new DevContractError(
      'DEV_STOP_FAILED',
      `Owned PID ${record.pid} did not stop within the bounded shutdown window`,
    );
  }
  await removePidRecordIfOwned(record);
}

async function buildPreview() {
  await runProductionBuild({ typecheck: false });
}

/**
 * @param {ServiceName} service
 * @returns {Promise<PidRecord>}
 */
async function startService(service) {
  const spec = serviceSpec(service);
  const ownerToken = createOwnerToken();
  const startedAt = new Date().toISOString();
  const logDescriptor = openSync(logFileFor(service), 'a', 0o600);
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawn(
      process.execPath,
      [
        SERVICE_ENTRY,
        '--service',
        service,
        '--port',
        String(spec.port),
        '--owner-token',
        ownerToken,
      ],
      {
        cwd: REPOSITORY_ROOT,
        detached: true,
        env: {
          ...process.env,
          TMPDIR: TMP_ROOT,
          TEMP: TMP_ROOT,
          TMP: TMP_ROOT,
        },
        stdio: ['ignore', logDescriptor, logDescriptor],
        windowsHide: true,
      },
    );
  } finally {
    closeSync(logDescriptor);
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      child.once('error', () => {});
      child.kill('SIGKILL');
      reject(
        new DevContractError(
          'DEV_SERVICE_SPAWN_TIMEOUT',
          `${service} did not complete its process-spawn handoff within 5000ms`,
        ),
      );
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    const onSpawn = () => {
      cleanup();
      resolve(undefined);
    };
    /** @param {Error} error */
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
  const childPid = child.pid;
  if (!Number.isSafeInteger(childPid) || /** @type {number} */ (childPid) <= 1) {
    child.kill('SIGKILL');
    throw new DevContractError('DEV_SERVICE_PID_INVALID', `${service} did not expose a safe PID`);
  }
  child.unref();
  return Object.freeze({
    schemaVersion: PID_SCHEMA_VERSION,
    repository: REPOSITORY,
    service,
    port: spec.port,
    pid: /** @type {number} */ (childPid),
    ownerToken,
    root: REPOSITORY_ROOT,
    startedAt,
  });
}

/**
 * @param {ServiceName} service
 * @param {number} timeoutMs
 */
async function waitForService(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await probeServiceHealth(service);
    } catch (error) {
      lastError = error;
      await delay(150);
    }
  }
  throw new DevContractError(
    'DEV_HEALTH_TIMEOUT',
    `${service} was not ready within ${timeoutMs}ms: ${safeMessage(lastError)}`,
  );
}

async function upImplementation() {
  const initialStates = await preflightImplementation();
  for (const state of initialStates) {
    if (state.state === 'owned-unhealthy' && state.record !== undefined) {
      await stopOwnedRecord(state.record);
    }
  }

  await buildPreview();
  /** @type {ServiceInspectionState[]} */
  const refreshed = [];
  for (const service of SERVICE_NAMES) {
    refreshed.push(await inspectService(service, { cleanDeadRecord: true }));
  }
  /** @type {PidRecord[]} */
  const started = [];
  try {
    for (const state of refreshed) {
      if (state.state === 'owned-healthy') continue;
      if (state.state !== 'free') {
        throw new DevContractError(
          'DEV_START_UNSAFE',
          `${state.service} changed to ${state.state} during startup`,
        );
      }
      started.push(await startService(state.service));
    }

    await Promise.all(SERVICE_NAMES.map((service) => waitForService(service, START_TIMEOUT_MS)));
  } catch (error) {
    const cleanupFailures = [];
    for (const record of started.reverse()) {
      try {
        await stopOwnedRecord(record);
      } catch (cleanupError) {
        cleanupFailures.push(`${record.service}: ${safeMessage(cleanupError)}`);
      }
    }
    if (cleanupFailures.length > 0) {
      const rollbackError = new DevContractError(
        'DEV_START_ROLLBACK_FAILED',
        `Startup failed with ${safeMessage(error)}; cleanup also failed for ${cleanupFailures.join('; ')}`,
      );
      rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }

  process.stdout.write(
    `${JSON.stringify({ event: 'dev.up.ready', services: SERVICE_NAMES, host: LOOPBACK_HOST })}\n`,
  );
}

async function downImplementation() {
  await loadAndValidatePorts();
  const failures = [];
  for (const service of [...SERVICE_NAMES].reverse()) {
    let record;
    try {
      record = await readPidRecord(service);
      if (record !== undefined) await stopOwnedRecord(record);
    } catch (error) {
      failures.push({ service, error: safeMessage(error) });
    }
  }

  for (const service of SERVICE_NAMES) {
    const spec = serviceSpec(service);
    const listeners = await listPortListeners(spec.port);
    if (listeners.length > 0) {
      failures.push({
        service,
        error: `Listener remains at ${listeners.map((item) => `${item.pid}@${item.address}`).join(',')}`,
      });
    }
  }

  if (failures.length > 0) {
    throw new DevContractError(
      'DEV_DOWN_INCOMPLETE',
      failures.map((failure) => `${failure.service}: ${failure.error}`).join('; '),
    );
  }
  process.stdout.write(`${JSON.stringify({ event: 'dev.down.complete' })}\n`);
}

async function healthImplementation() {
  await loadAndValidatePorts();
  const results = await Promise.allSettled(
    SERVICE_NAMES.map(async (service) => {
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      let lastState;
      while (Date.now() < deadline) {
        lastState = await inspectService(service, { cleanDeadRecord: false });
        if (lastState.state === 'owned-healthy') {
          return Object.freeze({ service, port: lastState.port, status: 'ready' });
        }
        await delay(150);
      }
      throw new DevContractError(
        'DEV_HEALTH_OWNERSHIP_FAILED',
        `${service} did not become an owned healthy listener; last state was ${lastState?.state ?? 'unknown'}`,
      );
    }),
  );
  const failures = [];
  for (const [index, result] of results.entries()) {
    const service = SERVICE_NAMES[index];
    if (result.status === 'fulfilled') {
      process.stdout.write(`${JSON.stringify({ event: 'dev.health.ready', ...result.value })}\n`);
    } else {
      failures.push(`${service}: ${safeMessage(result.reason)}`);
    }
  }
  const reservedListeners = await Promise.all(
    [4214, 4215, 4216, 4217, 4218, 4219].map(async (port) => ({
      port,
      listeners: await listPortListeners(port),
    })),
  );
  for (const { port, listeners } of reservedListeners) {
    if (listeners.length > 0) {
      failures.push(
        `reserved-${port}: foreign listener ${listeners.map((listener) => `${listener.pid}@${listener.address}`).join(',')}`,
      );
    } else {
      process.stdout.write(
        `${JSON.stringify({ event: 'dev.health.reserved_free', host: LOOPBACK_HOST, port })}\n`,
      );
    }
  }
  if (failures.length > 0) {
    throw new DevContractError('DEV_HEALTH_FAILED', failures.join('; '));
  }
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (
    extra.length > 0 ||
    typeof command !== 'string' ||
    !['preflight', 'up', 'down', 'health'].includes(command)
  ) {
    throw new DevContractError(
      'DEV_COMMAND_INVALID',
      'Expected exactly one of preflight, up, down, or health',
    );
  }

  if (command === 'health') {
    await ensureRuntimeDirectories();
    await healthImplementation();
    return;
  }

  await withControlLock(async () => {
    if (command === 'preflight') await preflightImplementation();
    else if (command === 'up') await upImplementation();
    else await downImplementation();
  });
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ code: errorCode(error) ?? 'DEV_LIFECYCLE_FAILED', message: safeMessage(error) })}\n`,
  );
  process.exitCode = 1;
});
