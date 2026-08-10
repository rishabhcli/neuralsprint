import { spawn } from 'node:child_process';
import path from 'node:path';

/** @typedef {'inherit' | 'capture'} BoundedChildStdio */
/**
 * @typedef {Readonly<{
 *   command: string;
 *   args?: readonly string[];
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 *   stdio?: BoundedChildStdio;
 *   tee?: boolean;
 *   timeoutMs: number;
 *   terminationGraceMs?: number;
 *   forceKillWaitMs?: number;
 *   maximumOutputBytes?: number;
 * }>} BoundedChildOptions
 */
/** @typedef {BoundedChildOptions & { stdio: 'capture' }} CapturedBoundedChildOptions */
/**
 * @typedef {Readonly<{
 *   command: string;
 *   args: readonly string[];
 *   cwd: string;
 *   env: NodeJS.ProcessEnv;
 *   stdio: BoundedChildStdio;
 *   tee: boolean;
 *   timeoutMs: number;
 *   terminationGraceMs: number;
 *   forceKillWaitMs: number;
 *   maximumOutputBytes: number;
 * }>} NormalizedBoundedChildOptions
 */
/**
 * @typedef {Readonly<{
 *   command: string;
 *   exitCode: number | null;
 *   signal: NodeJS.Signals | null;
 *   durationMs: number;
 *   escalated: boolean;
 *   stdout: Buffer | undefined;
 *   stderr: Buffer | undefined;
 * }>} BoundedChildResult
 */
/**
 * @typedef {Omit<BoundedChildResult, 'stdout' | 'stderr'> & {
 *   stdout: Buffer;
 *   stderr: Buffer;
 * }} CapturedBoundedChildResult
 */
/**
 * @typedef {
 *   | 'BOUNDED_CHILD_OPTIONS_INVALID'
 *   | 'BOUNDED_CHILD_SPAWN_FAILED'
 *   | 'BOUNDED_CHILD_TIMEOUT'
 *   | 'BOUNDED_CHILD_OUTPUT_LIMIT'
 *   | 'BOUNDED_CHILD_PARENT_SIGNAL'
 *   | 'BOUNDED_CHILD_SIGNALLED'
 *   | 'BOUNDED_CHILD_EXIT_NONZERO'
 *   | 'BOUNDED_CHILD_TERMINATION_FAILED'
 * } BoundedChildErrorCode
 */
/**
 * @typedef {'BOUNDED_CHILD_TIMEOUT' | 'BOUNDED_CHILD_OUTPUT_LIMIT' | 'BOUNDED_CHILD_PARENT_SIGNAL'} TerminationCode
 */
/**
 * @typedef {Readonly<{
 *   code: TerminationCode;
 *   parentSignal: NodeJS.Signals | undefined;
 * }>} TerminationReason
 */

const MAXIMUM_TIMER_MS = 2_147_483_647;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_FORCE_KILL_WAIT_MS = 1_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024;

export class BoundedChildError extends Error {
  /**
   * @param {BoundedChildErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    const { cause, ...safeDetails } = details;
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = 'BoundedChildError';
    this.code = code;
    Object.assign(this, safeDetails);
  }
}

/** @param {string} message */
function optionsError(message) {
  return new BoundedChildError('BOUNDED_CHILD_OPTIONS_INVALID', message);
}

/**
 * @param {number} value
 * @param {string} name
 * @param {{ allowZero?: boolean }} [options]
 */
function validateDuration(value, name, { allowZero = false } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    value > MAXIMUM_TIMER_MS ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw optionsError(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer no greater than ${MAXIMUM_TIMER_MS}`,
    );
  }
}

/**
 * @param {BoundedChildOptions} options
 * @returns {NormalizedBoundedChildOptions}
 */
function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw optionsError('options must be an object');
  }

  const {
    command,
    args = [],
    cwd = process.cwd(),
    env = process.env,
    stdio = 'inherit',
    tee = false,
    timeoutMs,
    terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
    forceKillWaitMs = DEFAULT_FORCE_KILL_WAIT_MS,
    maximumOutputBytes = DEFAULT_MAXIMUM_OUTPUT_BYTES,
  } = options;

  if (typeof command !== 'string' || command.trim().length === 0) {
    throw optionsError('command must be a non-empty string');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw optionsError('args must be an array of strings');
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw optionsError('cwd must be a non-empty string');
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw optionsError('env must be an object');
  }
  if (stdio !== 'inherit' && stdio !== 'capture') {
    throw optionsError('stdio must be either inherit or capture');
  }
  if (typeof tee !== 'boolean' || (tee && stdio !== 'capture')) {
    throw optionsError('tee must be a boolean and requires stdio=capture');
  }
  validateDuration(timeoutMs, 'timeoutMs');
  validateDuration(terminationGraceMs, 'terminationGraceMs', { allowZero: true });
  validateDuration(forceKillWaitMs, 'forceKillWaitMs');
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0) {
    throw optionsError('maximumOutputBytes must be a positive safe integer');
  }

  return Object.freeze({
    command,
    args: [...args],
    cwd,
    env,
    stdio,
    tee,
    timeoutMs,
    terminationGraceMs,
    forceKillWaitMs,
    maximumOutputBytes,
  });
}

/** @param {string} command */
function displayCommand(command) {
  return path.basename(command) || command;
}

/**
 * Run one child process with bounded time and, when captured, bounded output.
 * On POSIX the child receives its own process group so timeout escalation also
 * reaches descendants. Windows retains Node's direct-child signal behavior.
 *
 * @overload
 * @param {CapturedBoundedChildOptions} options
 * @returns {Promise<CapturedBoundedChildResult>}
 */
/**
 * @overload
 * @param {BoundedChildOptions} options
 * @returns {Promise<BoundedChildResult>}
 */
/** @param {BoundedChildOptions} options */
export function runBoundedChild(options) {
  const normalized = normalizeOptions(options);
  const startedAt = Date.now();
  const useProcessGroup = process.platform !== 'win32';

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    /** @type {unknown[]} */
    const signalErrors = [];
    let capturedBytes = 0;
    let settled = false;
    /** @type {TerminationReason | undefined} */
    let terminationReason;
    let escalated = false;
    /** @type {NodeJS.Timeout | undefined} */
    let deadlineTimer;
    /** @type {NodeJS.Timeout | undefined} */
    let escalationTimer;
    /** @type {NodeJS.Timeout | undefined} */
    let forceKillTimer;

    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(normalized.command, normalized.args, {
        cwd: normalized.cwd,
        env: normalized.env,
        detached: useProcessGroup,
        stdio:
          normalized.stdio === 'capture'
            ? ['ignore', 'pipe', 'pipe']
            : ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      });
    } catch (cause) {
      reject(
        new BoundedChildError(
          'BOUNDED_CHILD_SPAWN_FAILED',
          `${displayCommand(normalized.command)} could not be started`,
          { cause, command: normalized.command },
        ),
      );
      return;
    }

    /** @type {Readonly<Record<'SIGINT' | 'SIGTERM', () => void>>} */
    const parentSignalHandlers = {
      SIGINT: () => requestTermination('BOUNDED_CHILD_PARENT_SIGNAL', 'SIGINT', 'SIGINT'),
      SIGTERM: () => requestTermination('BOUNDED_CHILD_PARENT_SIGNAL', 'SIGTERM', 'SIGTERM'),
    };

    /** @returns {{ stdout: Buffer | undefined; stderr: Buffer | undefined }} */
    function capturedOutput() {
      if (normalized.stdio !== 'capture') {
        return { stdout: undefined, stderr: undefined };
      }
      return {
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      };
    }

    /**
     * @param {number | null} exitCode
     * @param {NodeJS.Signals | null} signal
     * @returns {BoundedChildResult}
     */
    function outcome(exitCode, signal) {
      return {
        command: normalized.command,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        escalated,
        ...capturedOutput(),
      };
    }

    /** @param {{ abandonChild?: boolean }} [options] */
    function cleanup({ abandonChild = false } = {}) {
      clearTimeout(deadlineTimer);
      clearTimeout(escalationTimer);
      clearTimeout(forceKillTimer);
      for (const [signal, handler] of Object.entries(parentSignalHandlers)) {
        process.removeListener(signal, handler);
      }
      if (abandonChild) {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.removeAllListeners();
        child.unref();
      }
    }

    /** @param {BoundedChildResult} value */
    function settleResolve(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    /**
     * @param {unknown} error
     * @param {{ abandonChild?: boolean }} [options]
     */
    function settleReject(error, { abandonChild = false } = {}) {
      if (settled) return;
      settled = true;
      cleanup({ abandonChild });
      reject(error);
    }

    /** @param {NodeJS.Signals} signal */
    function sendSignal(signal) {
      try {
        if (useProcessGroup && child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
        return true;
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ESRCH') {
          signalErrors.push(error);
        }
        return false;
      }
    }

    /**
     * @param {TerminationCode} code
     * @param {NodeJS.Signals} initialSignal
     * @param {NodeJS.Signals} [parentSignal]
     */
    function requestTermination(code, initialSignal, parentSignal = undefined) {
      if (terminationReason !== undefined || settled) return;
      terminationReason = Object.freeze({ code, parentSignal });
      clearTimeout(deadlineTimer);
      sendSignal(initialSignal);
      escalationTimer = setTimeout(() => {
        escalated = true;
        sendSignal('SIGKILL');
        forceKillTimer = setTimeout(() => {
          const result = outcome(null, null);
          settleReject(
            new BoundedChildError(
              'BOUNDED_CHILD_TERMINATION_FAILED',
              `${displayCommand(normalized.command)} did not close after forced termination`,
              {
                cause: signalErrors[0],
                reasonCode: code,
                ...result,
              },
            ),
            { abandonChild: true },
          );
        }, normalized.forceKillWaitMs);
      }, normalized.terminationGraceMs);
    }

    /**
     * @param {'stdout' | 'stderr'} kind
     * @param {Buffer} chunk
     */
    function capture(kind, chunk) {
      if (settled || terminationReason !== undefined) return;

      const availableBytes = normalized.maximumOutputBytes - capturedBytes;
      if (availableBytes > 0) {
        const retained =
          chunk.byteLength <= availableBytes ? chunk : chunk.subarray(0, availableBytes);
        const retainedCopy = Buffer.from(retained);
        if (kind === 'stdout') stdoutChunks.push(retainedCopy);
        else stderrChunks.push(retainedCopy);
        if (normalized.tee) {
          const destination = kind === 'stdout' ? process.stdout : process.stderr;
          destination.write(retainedCopy);
        }
        capturedBytes += retained.byteLength;
      }
      if (chunk.byteLength > availableBytes) {
        requestTermination('BOUNDED_CHILD_OUTPUT_LIMIT', 'SIGTERM');
      }
    }

    if (normalized.stdio === 'capture') {
      const stdout = /** @type {import('node:stream').Readable} */ (child.stdout);
      const stderr = /** @type {import('node:stream').Readable} */ (child.stderr);
      stdout.on('data', (chunk) => capture('stdout', chunk));
      stderr.on('data', (chunk) => capture('stderr', chunk));
    }

    child.once('error', (cause) => {
      settleReject(
        new BoundedChildError(
          'BOUNDED_CHILD_SPAWN_FAILED',
          `${displayCommand(normalized.command)} could not be started`,
          { cause, command: normalized.command, ...capturedOutput() },
        ),
      );
    });

    child.once('close', (code, signal) => {
      const result = outcome(code, signal);
      if (terminationReason?.code === 'BOUNDED_CHILD_TIMEOUT') {
        settleReject(
          new BoundedChildError(
            'BOUNDED_CHILD_TIMEOUT',
            `${displayCommand(normalized.command)} exceeded ${normalized.timeoutMs}ms`,
            { timeoutMs: normalized.timeoutMs, ...result },
          ),
        );
        return;
      }
      if (terminationReason?.code === 'BOUNDED_CHILD_OUTPUT_LIMIT') {
        settleReject(
          new BoundedChildError(
            'BOUNDED_CHILD_OUTPUT_LIMIT',
            `${displayCommand(normalized.command)} exceeded ${normalized.maximumOutputBytes} captured bytes`,
            { maximumOutputBytes: normalized.maximumOutputBytes, ...result },
          ),
        );
        return;
      }
      if (terminationReason?.code === 'BOUNDED_CHILD_PARENT_SIGNAL') {
        settleReject(
          new BoundedChildError(
            'BOUNDED_CHILD_PARENT_SIGNAL',
            `${displayCommand(normalized.command)} was interrupted by ${terminationReason.parentSignal}`,
            { parentSignal: terminationReason.parentSignal, ...result },
          ),
        );
        return;
      }
      if (code === 0 && signal === null) {
        settleResolve(result);
        return;
      }
      if (signal !== null) {
        settleReject(
          new BoundedChildError(
            'BOUNDED_CHILD_SIGNALLED',
            `${displayCommand(normalized.command)} exited on ${signal}`,
            result,
          ),
        );
        return;
      }
      settleReject(
        new BoundedChildError(
          'BOUNDED_CHILD_EXIT_NONZERO',
          `${displayCommand(normalized.command)} exited with code ${String(code)}`,
          result,
        ),
      );
    });

    for (const [signal, handler] of Object.entries(parentSignalHandlers)) {
      process.on(signal, handler);
    }
    deadlineTimer = setTimeout(
      () => requestTermination('BOUNDED_CHILD_TIMEOUT', 'SIGTERM'),
      normalized.timeoutMs,
    );
  });
}
