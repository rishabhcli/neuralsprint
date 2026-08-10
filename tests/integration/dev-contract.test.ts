import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTROL_IDENTITY_PATH, CONTROL_SHUTDOWN_PATH } from '../../scripts/lib/dev-contract.mjs';
import { validateReadyDocument } from '../../scripts/lib/service-health.mjs';

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve('.');
const HTTP_TIMEOUT_MS = 20_000;

async function executeNode(args: string[], timeoutMs = 60_000) {
  const result = await executeFile(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.stderr.trim().length > 0) {
    throw new Error(`TEST_CHILD_DIAGNOSTIC_REFUSED: ${result.stderr.trim()}`);
  }
  return result;
}

beforeAll(async () => {
  await executeNode(['scripts/dev-lifecycle.mjs', 'up'], 150_000);
  await executeNode(['scripts/dev-lifecycle.mjs', 'health'], 60_000);
}, 180_000);

afterAll(async () => {
  await executeNode(['scripts/dev-lifecycle.mjs', 'health'], 60_000);
}, 90_000);

describe('development lifecycle integration contract', () => {
  it('preflights the exact repository-owned ports without starting a listener', async () => {
    const portsBefore = await listenerPids();
    const { stdout } = await executeNode(['scripts/dev-lifecycle.mjs', 'preflight'], 60_000);
    const portsAfter = await listenerPids();

    expect(stdout).toContain('"event":"dev.preflight.port"');
    for (const port of [4210, 4211, 4212, 4213, 4214, 4215, 4216, 4217, 4218, 4219]) {
      expect(stdout).toContain(`"port":${String(port)}`);
    }
    expect(portsAfter).toEqual(portsBefore);
  }, 90_000);

  it('deterministically generates a real covered-text PDF and matching manifest', async () => {
    const corpusRoot = path.join('.dev', 'tmp', 'fixture-contract-test');
    await rm(corpusRoot, { recursive: true, force: true });
    const moduleUrl = pathToFileURL(
      path.join(repositoryRoot, 'scripts/lib/fixture-corpus.mjs'),
    ).href;
    const script = [
      `const m = await import(${JSON.stringify(moduleUrl)});`,
      `await m.generateFixtureCorpus(${JSON.stringify(path.join(repositoryRoot, corpusRoot))});`,
      `await m.verifyFixtureCorpus(${JSON.stringify(path.join(repositoryRoot, corpusRoot))});`,
    ].join(' ');
    await executeNode(['--input-type=module', '--eval', script]);

    const manifest = JSON.parse(await readFile(path.join(corpusRoot, 'manifest.json'), 'utf8')) as {
      schemaVersion: number;
      fixtures: { file: string; bytes: number; sha256: string }[];
    };
    const fixture = manifest.fixtures[0];
    if (fixture === undefined) throw new Error('fixture manifest must include one entry');
    const bytes = await readFile(path.join(corpusRoot, fixture.file));

    expect(manifest.schemaVersion).toBe(1);
    expect(bytes.subarray(0, 8).toString('binary')).toMatch(/^%PDF-1\./u);
    expect(bytes.subarray(-32).toString('binary')).toContain('%%EOF');
    expect(bytes.toString('binary')).toContain('SYNTHETIC TOKEN 000-00-0000');
    expect(bytes.toString('binary')).toMatch(/Tj[\s\S]*re\nf/u);
    expect(bytes.byteLength).toBe(fixture.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
  }, 60_000);

  it('rejects fixture path traversal and unsupported methods', async () => {
    const traversal = await fetch('http://127.0.0.1:4213/fixtures/..%2F..%2Fpackage.json.pdf', {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const mutation = await fetch('http://127.0.0.1:4213/manifest.json', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    expect(traversal.status).toBe(400);
    expect(await traversal.json()).toEqual({ code: 'DEV_FIXTURE_PATH_INVALID' });
    expect(mutation.status).toBe(405);
    expect(await mutation.json()).toEqual({ code: 'DEV_FIXTURE_METHOD_NOT_ALLOWED' });
  }, 60_000);

  it('refuses missing and incorrect control nonces without changing readiness', async () => {
    const origin = 'http://127.0.0.1:4210';
    const missing = await fetch(`${origin}${CONTROL_IDENTITY_PATH}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const incorrect = await fetch(`${origin}${CONTROL_SHUTDOWN_PATH}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'X-Neuralsprint-Owner-Token': '0'.repeat(64) },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const ready = await fetch(`${origin}/__neuralsprint/ready`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const live = await fetch(`${origin}/__neuralsprint/live`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ code: 'DEV_CONTROL_FORBIDDEN' });
    expect(incorrect.status).toBe(403);
    expect(await incorrect.json()).toEqual({ code: 'DEV_CONTROL_FORBIDDEN' });
    expect(ready.status).toBe(200);
    expect(validateReadyDocument(await ready.json(), 'app-dev', 4210).status).toBe('ready');
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({
      schemaVersion: 1,
      repository: 'neuralsprint',
      service: 'app-dev',
      host: '127.0.0.1',
      port: 4210,
      status: 'alive',
    });
  }, 60_000);

  it('refuses a symlinked fixture corpus root', async () => {
    const target = path.join('.dev', 'tmp', 'fixture-symlink-target');
    const link = path.join('.dev', 'tmp', 'fixture-symlink-test');
    await rm(target, { recursive: true, force: true });
    await unlink(link).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
    await mkdir(target, { mode: 0o700 });
    await symlink(path.resolve(target), link, 'dir');

    try {
      const moduleUrl = pathToFileURL(
        path.join(repositoryRoot, 'scripts/lib/fixture-corpus.mjs'),
      ).href;
      const script = [
        `const m = await import(${JSON.stringify(moduleUrl)});`,
        `await m.generateFixtureCorpus(${JSON.stringify(path.join(repositoryRoot, link))});`,
      ].join(' ');
      let failure: unknown;
      try {
        await executeNode(['--input-type=module', '--eval', script]);
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeDefined();
      expect(errorDetails(failure)).toContain('DEV_FIXTURE_ROOT_INVALID');
    } finally {
      await unlink(link);
      await rm(target, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves a malformed lifecycle lock and recovers an atomically recorded dead owner', async () => {
    const lock = path.join('.dev', 'tmp', 'dev-lifecycle.lock');
    await unlink(lock).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
    await writeFile(lock, '{malformed\n', { flag: 'wx', mode: 0o600 });
    try {
      let malformedFailure: unknown;
      try {
        await executeNode(['scripts/dev-lifecycle.mjs', 'preflight'], 60_000);
      } catch (error: unknown) {
        malformedFailure = error;
      }
      expect(errorDetails(malformedFailure)).toContain('DEV_LIFECYCLE_LOCK_INVALID');
      expect(await readFile(lock, 'utf8')).toBe('{malformed\n');
    } finally {
      await unlink(lock);
    }

    await writeFile(
      lock,
      `${JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        token: 'a'.repeat(64),
        startedAt: '2026-08-10T00:00:00.000Z',
      })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await executeNode(['scripts/dev-lifecycle.mjs', 'preflight'], 60_000);
    await expect(readFile(lock, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('refuses to kill a foreign allocated-port listener and restores owned health', async () => {
    await executeNode(['scripts/dev-lifecycle.mjs', 'down'], 90_000);

    const foreign = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "import { createServer } from 'node:http';",
          "const server = createServer((_request, response) => response.end('foreign'));",
          "server.listen({ host: '127.0.0.1', port: 4210, exclusive: true }, () => process.stdout.write('ready\\n'));",
          "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
        ].join(' '),
      ],
      { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const failures: unknown[] = [];
    try {
      await waitForOutput(foreign, 'ready');
      let preflightFailure: unknown;
      try {
        await executeNode(['scripts/dev-lifecycle.mjs', 'preflight'], 60_000);
      } catch (error: unknown) {
        preflightFailure = error;
      }
      expect(errorDetails(preflightFailure)).toContain('DEV_PREFLIGHT_FAILED');
      expect(foreign.exitCode).toBeNull();

      let failure: unknown;
      try {
        await executeNode(['scripts/dev-lifecycle.mjs', 'down'], 90_000);
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBeDefined();
      expect(errorDetails(failure)).toContain('DEV_DOWN_INCOMPLETE');
      expect(foreign.exitCode).toBeNull();
      expect((await listenerPids())['4210']).toContain(`p${String(foreign.pid)}`);
    } catch (error: unknown) {
      failures.push(error);
    }

    if (foreign.exitCode === null && foreign.signalCode === null) foreign.kill('SIGTERM');
    try {
      await waitForExit(foreign);
    } catch (error: unknown) {
      failures.push(
        new Error(`TEST_FOREIGN_LISTENER_CLEANUP_ESCALATED: ${errorDetails(error)}`, {
          cause: error,
        }),
      );
      if (foreign.exitCode === null && foreign.signalCode === null) foreign.kill('SIGKILL');
      try {
        await waitForExit(foreign);
      } catch (forcedError: unknown) {
        failures.push(forcedError);
      }
    }
    try {
      await executeNode(['scripts/dev-lifecycle.mjs', 'up'], 150_000);
      await executeNode(['scripts/dev-lifecycle.mjs', 'health'], 60_000);
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Foreign-listener refusal or cleanup contract failed');
    }
  }, 300_000);
});

async function waitForOutput(
  child: ReturnType<typeof spawn>,
  expected: string,
  timeoutMs = 30_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onData = (chunk: Buffer) => {
      if (!chunk.toString('utf8').includes(expected)) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`child exited ${String(code)} before emitting ${expected}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`child did not emit ${expected}`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 15_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('child did not exit')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function listenerPids(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    [4210, 4211, 4212, 4213, 4214, 4215, 4216, 4217, 4218, 4219].map(async (port) => {
      try {
        const { stdout } = await executeFile(
          'lsof',
          ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fp'],
          {
            cwd: repositoryRoot,
            encoding: 'utf8',
            killSignal: 'SIGKILL',
            maxBuffer: 1024 * 1024,
            timeout: 15_000,
          },
        );
        return [String(port), stdout.trim()] as const;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code !== 1 && code !== '1') throw error;
        return [String(port), ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  return `${error.message}\n${stderr}`;
}
