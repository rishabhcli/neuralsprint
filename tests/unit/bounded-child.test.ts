import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

interface BoundedChildResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout?: Buffer;
  stderr?: Buffer;
  escalated: boolean;
}

interface BoundedChildFailure extends Error {
  code: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout?: Buffer;
  stderr?: Buffer;
  escalated: boolean;
  parentSignal?: NodeJS.Signals;
  maximumOutputBytes?: number;
  timeoutMs?: number;
}

interface RunBoundedChildOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: 'capture' | 'inherit';
  tee?: boolean;
  timeoutMs: number;
  terminationGraceMs?: number;
  forceKillWaitMs?: number;
  maximumOutputBytes?: number;
}

type RunBoundedChild = (options: RunBoundedChildOptions) => Promise<BoundedChildResult>;

const repositoryRoot = path.resolve('.');
const helperUrl = pathToFileURL(path.join(repositoryRoot, 'scripts/lib/bounded-child.mjs')).href;
let runBoundedChild: RunBoundedChild;

beforeAll(async () => {
  const loaded = (await import(helperUrl)) as { runBoundedChild: RunBoundedChild };
  runBoundedChild = loaded.runBoundedChild;
});

describe('bounded child runner', () => {
  it('captures successful output within the declared bound', async () => {
    const result = await runBoundedChild({
      command: process.execPath,
      args: [
        '--eval',
        "process.stdout.write('captured-out'); process.stderr.write('captured-error')",
      ],
      cwd: repositoryRoot,
      stdio: 'capture',
      timeoutMs: 10_000,
      maximumOutputBytes: 1_024,
    });

    expect(result).toMatchObject({ exitCode: 0, signal: null, escalated: false });
    expect(result.stdout?.toString('utf8')).toBe('captured-out');
    expect(result.stderr?.toString('utf8')).toBe('captured-error');
  });

  it('returns a stable coded failure for a non-zero exit and removes signal listeners', async () => {
    const before = listenerCounts();
    let failure: unknown;
    try {
      await runBoundedChild({
        command: process.execPath,
        args: ['--eval', "process.stderr.write('expected failure'); process.exit(7)"],
        cwd: repositoryRoot,
        stdio: 'capture',
        timeoutMs: 10_000,
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const observed = failure as BoundedChildFailure;
    expect(observed.code).toBe('BOUNDED_CHILD_EXIT_NONZERO');
    expect(observed.stderr?.toString('utf8')).toBe('expected failure');
    expect(listenerCounts()).toEqual(before);
  });

  it('terminates a child that exceeds the capture bound', async () => {
    const flood = outputFloodCommand();
    let failure: unknown;
    try {
      await runBoundedChild({
        command: flood.command,
        args: flood.args,
        cwd: repositoryRoot,
        stdio: 'capture',
        timeoutMs: 10_000,
        terminationGraceMs: 50,
        forceKillWaitMs: 250,
        maximumOutputBytes: 128,
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const observed = failure as BoundedChildFailure;
    expect(observed.code).toBe('BOUNDED_CHILD_OUTPUT_LIMIT');
    expect(observed.maximumOutputBytes).toBe(128);
    expect(observed.stdout?.byteLength).toBe(128);
  });

  it('caps live tee output at the same aggregate capture bound', async () => {
    const wrapper = [
      `const { runBoundedChild } = await import(${JSON.stringify(helperUrl)})`,
      'try {',
      `  await runBoundedChild({ command: process.execPath, args: ['--eval', ${JSON.stringify("process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)")}], cwd: ${JSON.stringify(repositoryRoot)}, stdio: 'capture', tee: true, timeoutMs: 10000, terminationGraceMs: 100, forceKillWaitMs: 2000, maximumOutputBytes: 128 })`,
      '} catch (error) {',
      '  process.stderr.write(`wrapper:${error.code}:${error.stdout.byteLength}\n`)',
      '}',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = collectChildOutput(child);
    let result: Awaited<typeof output>;

    try {
      result = await output;
    } finally {
      await stopTestChild(child, output);
    }

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('x'.repeat(128));
    expect(result.stderr).toBe('wrapper:BOUNDED_CHILD_OUTPUT_LIMIT:128\n');
  }, 20_000);

  it.skipIf(process.platform === 'win32')(
    'escalates from SIGTERM to SIGKILL after the timeout grace period',
    async () => {
      let failure: unknown;
      try {
        await runBoundedChild({
          command: process.execPath,
          args: [
            '--eval',
            "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
          ],
          cwd: repositoryRoot,
          stdio: 'capture',
          timeoutMs: 3_000,
          terminationGraceMs: 100,
          forceKillWaitMs: 250,
          maximumOutputBytes: 1_024,
        });
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      const observed = failure as BoundedChildFailure;
      expect(observed.code).toBe('BOUNDED_CHILD_TIMEOUT');
      expect(observed.timeoutMs).toBe(3_000);
      expect(observed.escalated).toBe(true);
      expect(observed.stdout?.toString('utf8')).toBe('ready');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'forwards a parent SIGTERM and restores the parent listener set',
    async () => {
      const inner = [
        "process.on('SIGTERM', () => { process.stdout.write('inner-term\\n'); process.exit(0) })",
        "process.stdout.write('inner-ready\\n')",
        'setInterval(() => {}, 1000)',
      ].join('; ');
      const wrapper = [
        `const { runBoundedChild } = await import(${JSON.stringify(helperUrl)})`,
        "const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]",
        'try {',
        `  await runBoundedChild({ command: process.execPath, args: ['--eval', ${JSON.stringify(inner)}], cwd: ${JSON.stringify(repositoryRoot)}, stdio: 'inherit', timeoutMs: 10000, terminationGraceMs: 100, forceKillWaitMs: 250 })`,
        '} catch (error) {',
        "  const after = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]",
        "  process.stdout.write(`wrapper:${error.code}:${before.join(',')}:${after.join(',')}\\n`)",
        '}',
      ].join('\n');
      const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
        cwd: repositoryRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const ready = waitForText(child, 'inner-ready');
      const output = collectChildOutput(child);
      let result: Awaited<typeof output>;

      try {
        await ready;
        child.kill('SIGTERM');
        result = await output;
      } finally {
        await stopTestChild(child, output);
      }

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('inner-term');
      expect(result.stdout).toContain('wrapper:BOUNDED_CHILD_PARENT_SIGNAL:0,0:0,0');
    },
    15_000,
  );
});

function listenerCounts(): readonly [number, number] {
  return [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')] as const;
}

function outputFloodCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [
      '--input-type=module',
      '--eval',
      "import { writeSync } from 'node:fs'; writeSync(1, Buffer.alloc(4096, 120)); setInterval(() => {}, 1000)",
    ],
  };
}

function collectChildOutput(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function stopTestChild(
  child: ReturnType<typeof spawn>,
  output: ReturnType<typeof collectChildOutput>,
): Promise<void> {
  if (childHasClosed(child)) return;

  child.kill('SIGTERM');
  await Promise.race([output.catch(() => undefined), delay(1_000)]);
  if (childHasClosed(child)) return;

  child.kill('SIGKILL');
  await Promise.race([output.catch(() => undefined), delay(1_000)]);
}

function childHasClosed(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForText(
  child: ReturnType<typeof spawn>,
  expected: string,
  timeoutMs = 6_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('close', onClose);
    }
    function onData(chunk: Buffer) {
      if (!chunk.toString('utf8').includes(expected)) return;
      cleanup();
      resolve();
    }
    function onError(error: Error) {
      cleanup();
      reject(error);
    }
    function onClose(code: number | null, signal: NodeJS.Signals | null) {
      cleanup();
      reject(
        new Error(`child closed (${signal ?? `exit ${String(code)}`}) before emitting ${expected}`),
      );
    }
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`child did not emit ${expected}`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('close', onClose);
  });
}
