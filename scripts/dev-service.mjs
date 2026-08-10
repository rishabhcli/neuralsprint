#!/usr/bin/env node

import path from 'node:path';

import { startFixtureServer } from './fixture-server.mjs';
import {
  CACHE_ROOT,
  DevContractError,
  LOOPBACK_HOST,
  PID_SCHEMA_VERSION,
  REPOSITORY,
  REPOSITORY_ROOT,
  ensureRuntimeDirectories,
  isProcessAlive,
  loadAndValidatePorts,
  readPidRecord,
  removePidRecordIfOwned,
  serviceSpec,
  validateOwnerToken,
  writePidRecord,
} from './lib/dev-contract.mjs';
import { probeSemanticSurface } from './lib/readiness-probes.mjs';
import { createHealthController } from './lib/service-health.mjs';

/** @typedef {'app-dev' | 'preview' | 'playwright' | 'fixtures'} ServiceName */
/** @typedef {ReturnType<typeof createHealthController>} HealthController */
/**
 * @typedef {Readonly<{
 *   service: ServiceName;
 *   port: number;
 *   ownerToken: string;
 *   spec: ReturnType<typeof serviceSpec>;
 * }>} ServiceArguments
 */
/** @typedef {Readonly<{ close(): Promise<void> }>} ServiceRuntime */
/** @typedef {Exclude<Awaited<ReturnType<typeof readPidRecord>>, undefined>} PidRecord */

/** @param {unknown} error */
function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {readonly string[]} argv
 * @returns {ServiceArguments}
 */
function parseArguments(argv) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      typeof key !== 'string' ||
      !['--service', '--port', '--owner-token'].includes(key) ||
      value === undefined
    ) {
      throw new DevContractError(
        'DEV_SERVICE_ARGUMENT_INVALID',
        'Expected --service, --port, and --owner-token arguments',
      );
    }
    if (values.has(key)) {
      throw new DevContractError('DEV_SERVICE_ARGUMENT_INVALID', `${key} was supplied twice`);
    }
    values.set(key, value);
  }

  const service = values.get('--service');
  const port = Number(values.get('--port'));
  const ownerToken = values.get('--owner-token');
  const spec = serviceSpec(service);
  if (
    values.size !== 3 ||
    !Number.isSafeInteger(port) ||
    port !== spec.port ||
    !validateOwnerToken(ownerToken)
  ) {
    throw new DevContractError(
      'DEV_SERVICE_ARGUMENT_INVALID',
      'Service arguments do not match the committed port contract',
    );
  }
  return Object.freeze({ service: /** @type {ServiceName} */ (service), port, ownerToken, spec });
}

/**
 * @param {ServiceArguments} arguments_
 * @returns {Promise<PidRecord>}
 */
async function reservePidRecord(arguments_) {
  const existing = await readPidRecord(arguments_.service);
  if (existing !== undefined) {
    if (isProcessAlive(existing.pid)) {
      throw new DevContractError(
        'DEV_SERVICE_ALREADY_RECORDED',
        `${arguments_.service} already has a live PID record`,
      );
    }
    await removePidRecordIfOwned(existing);
  }

  const record = Object.freeze({
    schemaVersion: PID_SCHEMA_VERSION,
    repository: REPOSITORY,
    service: arguments_.service,
    port: arguments_.port,
    pid: process.pid,
    ownerToken: arguments_.ownerToken,
    root: REPOSITORY_ROOT,
    startedAt: new Date().toISOString(),
  });
  await writePidRecord(record);
  return record;
}

/** @param {import('node:http').Server} server */
async function closeHttpServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve(undefined);
      else reject(error);
    });
    server.closeAllConnections?.();
  });
}

/**
 * @param {ServiceArguments} arguments_
 * @param {HealthController} healthController
 * @returns {Promise<ServiceRuntime>}
 */
async function startViteService(arguments_, healthController) {
  const vite = await import('vite');
  const common = {
    root: REPOSITORY_ROOT,
    configFile: path.join(REPOSITORY_ROOT, 'vite.config.ts'),
    cacheDir: path.join(CACHE_ROOT, `vite-${arguments_.service}`),
    clearScreen: false,
    plugins: [healthController.vitePlugin],
  };

  if (arguments_.service === 'preview') {
    const server = await vite.preview({
      ...common,
      preview: {
        host: LOOPBACK_HOST,
        port: arguments_.port,
        strictPort: true,
      },
    });
    return {
      async close() {
        const httpServer = /** @type {import('node:http').Server} */ (server.httpServer);
        await new Promise((resolve, reject) => {
          httpServer.close((error) => {
            if (error === undefined) resolve(undefined);
            else reject(error);
          });
          httpServer.closeAllConnections?.();
        });
      },
    };
  }

  const server = await vite.createServer({
    ...common,
    mode: arguments_.service === 'playwright' ? 'test' : 'development',
    server: {
      host: LOOPBACK_HOST,
      port: arguments_.port,
      strictPort: true,
    },
  });
  await server.listen();
  return {
    async close() {
      await server.close();
    },
  };
}

/**
 * @param {ServiceArguments} arguments_
 * @param {HealthController} healthController
 * @returns {Promise<ServiceRuntime>}
 */
async function startRuntime(arguments_, healthController) {
  if (arguments_.service === 'fixtures') {
    const server = await startFixtureServer({
      port: arguments_.port,
      healthController,
    });
    return {
      async close() {
        await closeHttpServer(server);
      },
    };
  }
  return startViteService(arguments_, healthController);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  await ensureRuntimeDirectories();
  await loadAndValidatePorts();
  const record = await reservePidRecord(arguments_);
  const healthController = createHealthController(arguments_);
  /** @type {ServiceRuntime | undefined} */
  let runtime;
  /** @type {Promise<void> | undefined} */
  let stopping;

  /** @param {string} reason */
  const stop = async (reason) => {
    if (stopping !== undefined) return stopping;
    stopping = (async () => {
      healthController.markNotReady([Object.freeze({ name: 'shutdown', status: 'pass' })]);
      process.stdout.write(
        `${JSON.stringify({ event: 'dev.service.stopping', service: arguments_.service, reason })}\n`,
      );
      if (runtime !== undefined) await runtime.close();
      await removePidRecordIfOwned(record);
    })();
    return stopping;
  };

  healthController.setShutdown(async () => {
    await stop('authenticated-control');
    process.exit(0);
  });

  /** @param {NodeJS.Signals} signal */
  const handleSignal = (signal) => {
    void stop(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'dev.service.stop_failed', service: arguments_.service, message: error.message })}\n`,
        );
        process.exit(1);
      });
  };
  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGHUP', () => handleSignal('SIGHUP'));

  try {
    runtime = await startRuntime(arguments_, healthController);
    const checks = await probeSemanticSurface(arguments_.service);
    healthController.markReady(checks);
    process.stdout.write(
      `${JSON.stringify({ event: 'dev.service.ready', service: arguments_.service, host: LOOPBACK_HOST, port: arguments_.port, pid: process.pid })}\n`,
    );
  } catch (error) {
    try {
      await stop('startup-failure');
    } catch (cleanupError) {
      const rollbackError = new DevContractError(
        'DEV_SERVICE_STARTUP_ROLLBACK_FAILED',
        `Startup failed with ${safeMessage(error)}; cleanup failed with ${safeMessage(cleanupError)}`,
      );
      rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }
}

main().catch(async (error) => {
  const code = /** @type {{ code?: unknown } | null | undefined} */ (error)?.code;
  if (code === 'EADDRINUSE') {
    process.stderr.write(
      `${JSON.stringify({ code: 'DEV_PORT_IN_USE', message: 'Configured port is already in use' })}\n`,
    );
  } else {
    process.stderr.write(
      `${JSON.stringify({ code: code ?? 'DEV_SERVICE_FAILED', message: safeMessage(error) })}\n`,
    );
  }
  process.exitCode = 1;
});
