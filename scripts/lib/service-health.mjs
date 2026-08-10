import { timingSafeEqual } from 'node:crypto';

import {
  CONTROL_IDENTITY_PATH,
  CONTROL_SHUTDOWN_PATH,
  LIVE_PATH,
  LOOPBACK_HOST,
  READY_PATH,
  REPOSITORY,
} from './dev-contract.mjs';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('vite').PreviewServer} PreviewServer */
/** @typedef {import('vite').ViteDevServer} ViteDevServer */
/** @typedef {Readonly<{ name: string; status: 'pass' }>} ReadyCheck */
/**
 * @typedef {Readonly<{
 *   schemaVersion: 1;
 *   repository: 'neuralsprint';
 *   service: string;
 *   host: '127.0.0.1';
 *   port: number;
 *   status: 'ready';
 *   checks: readonly ReadyCheck[];
 * }>} ReadyDocument
 */
/**
 * @typedef {(
 *   request: IncomingMessage,
 *   response: ServerResponse,
 *   next: (() => void) | undefined,
 * ) => void} HealthMiddleware
 */
/**
 * @typedef {Readonly<{
 *   middleware: HealthMiddleware;
 *   markReady(nextChecks: readonly ReadyCheck[]): void;
 *   markNotReady(nextChecks?: readonly ReadyCheck[]): void;
 *   setShutdown(callback: () => Promise<void>): void;
 *   vitePlugin: {
 *     name: string;
 *     configureServer(server: ViteDevServer): void;
 *     configurePreviewServer(server: PreviewServer): void;
 *   };
 * }>} HealthController
 */

const HEALTH_SCHEMA_VERSION = 1;

/**
 * @param {ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} body
 */
function writeJson(response, statusCode, body) {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(encoded.byteLength),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(encoded);
}

/**
 * @param {IncomingMessage} request
 * @param {string} ownerToken
 */
function hasValidToken(request, ownerToken) {
  const supplied = request.headers['x-neuralsprint-owner-token'];
  if (typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(ownerToken, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return (
    expectedBytes.byteLength === suppliedBytes.byteLength &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

/** @param {IncomingMessage} request */
function normalizedPath(request) {
  try {
    return new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
  } catch {
    return undefined;
  }
}

/**
 * @param {{ service: string; port: number; ownerToken: string }} options
 * @returns {HealthController}
 */
export function createHealthController({ service, port, ownerToken }) {
  let ready = false;
  /** @type {readonly ReadyCheck[]} */
  let checks = [];
  /** @type {undefined | (() => Promise<void>)} */
  let shutdown;

  const identity = Object.freeze({
    schemaVersion: HEALTH_SCHEMA_VERSION,
    repository: REPOSITORY,
    service,
    host: LOOPBACK_HOST,
    port,
  });

  /** @type {HealthMiddleware} */
  const middleware = (request, response, next) => {
    const pathname = normalizedPath(request);

    if (pathname === LIVE_PATH && request.method === 'GET') {
      writeJson(response, 200, { ...identity, status: 'alive' });
      return;
    }

    if (pathname === READY_PATH && request.method === 'GET') {
      writeJson(response, ready ? 200 : 503, {
        ...identity,
        status: ready ? 'ready' : 'not-ready',
        checks,
      });
      return;
    }

    if (pathname === CONTROL_IDENTITY_PATH && request.method === 'GET') {
      if (!hasValidToken(request, ownerToken)) {
        writeJson(response, 403, { code: 'DEV_CONTROL_FORBIDDEN' });
        return;
      }
      writeJson(response, 200, { ...identity, pid: process.pid });
      return;
    }

    if (pathname === CONTROL_SHUTDOWN_PATH && request.method === 'POST') {
      if (!hasValidToken(request, ownerToken)) {
        writeJson(response, 403, { code: 'DEV_CONTROL_FORBIDDEN' });
        return;
      }
      if (shutdown === undefined) {
        writeJson(response, 503, { code: 'DEV_CONTROL_NOT_READY' });
        return;
      }
      ready = false;
      writeJson(response, 202, { ...identity, status: 'stopping' });
      setImmediate(() => {
        void (
          /** @type {() => Promise<void>} */ (shutdown)().catch((error) => {
            process.stderr.write(
              `${JSON.stringify({
                event: 'dev.control.shutdown_failed',
                service,
                code:
                  /** @type {{ code?: unknown } | null | undefined} */ (error)?.code ??
                  'DEV_CONTROL_SHUTDOWN_FAILED',
                message:
                  /** @type {{ message?: unknown } | null | undefined} */ (error)?.message ??
                  String(error),
              })}\n`,
            );
          })
        );
      });
      return;
    }

    if (typeof next === 'function') next();
  };

  return Object.freeze({
    middleware,
    markReady(nextChecks) {
      checks = Object.freeze([...nextChecks]);
      ready = true;
    },
    markNotReady(nextChecks = checks) {
      checks = Object.freeze([...nextChecks]);
      ready = false;
    },
    setShutdown(callback) {
      shutdown = callback;
    },
    vitePlugin: {
      name: 'neuralsprint-dev-readiness',
      configureServer(server) {
        server.middlewares.use(middleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(middleware);
      },
    },
  });
}

/**
 * @param {unknown} value
 * @returns {value is ReadyCheck}
 */
function isReadyCheck(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  return typeof candidate.name === 'string' && candidate.status === 'pass';
}

/**
 * @param {unknown} value
 * @param {string} expectedService
 * @param {number} expectedPort
 * @returns {ReadyDocument}
 */
export function validateReadyDocument(value, expectedService, expectedPort) {
  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    candidate.schemaVersion !== HEALTH_SCHEMA_VERSION ||
    candidate.repository !== REPOSITORY ||
    candidate.service !== expectedService ||
    candidate.host !== LOOPBACK_HOST ||
    candidate.port !== expectedPort ||
    candidate.status !== 'ready' ||
    !Array.isArray(candidate.checks) ||
    candidate.checks.length < 1 ||
    !candidate.checks.every(isReadyCheck)
  ) {
    throw new Error(
      `DEV_READINESS_INVALID: ${expectedService} did not return its typed readiness contract`,
    );
  }
  return /** @type {ReadyDocument} */ (value);
}
