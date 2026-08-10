import { createServer } from 'node:http';
import path from 'node:path';

import { generateFixtureCorpus, loadVerifiedFixtureCorpus } from './lib/fixture-corpus.mjs';
import { LOOPBACK_HOST } from './lib/dev-contract.mjs';

/**
 * @typedef {import('node:http').IncomingMessage} IncomingMessage
 * @typedef {import('node:http').ServerResponse} ServerResponse
 * @typedef {{
 *   middleware: (
 *     request: IncomingMessage,
 *     response: ServerResponse,
 *     next: () => Promise<void>,
 *   ) => void,
 * }} FixtureHealthController
 */

const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:4210',
  'http://127.0.0.1:4211',
  'http://127.0.0.1:4212',
]);

/**
 * @param {ServerResponse} response
 * @param {number} statusCode
 * @param {string} contentType
 * @param {string | Buffer} body
 * @param {string | undefined} requestMethod
 * @returns {void}
 */
function writeResponse(response, statusCode, contentType, body, requestMethod) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(bytes.byteLength),
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  if (requestMethod === 'HEAD') response.end();
  else response.end(bytes);
}

/**
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 * @returns {void}
 */
function applyCors(request, response) {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
}

/**
 * @param {{ port: number, healthController: FixtureHealthController }} options
 * @returns {Promise<import('node:http').Server>}
 */
export async function startFixtureServer({ port, healthController }) {
  await generateFixtureCorpus();
  const corpus = await loadVerifiedFixtureCorpus();

  const server = createServer((request, response) => {
    healthController.middleware(request, response, async () => {
      applyCors(request, response);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeResponse(
          response,
          405,
          'application/json; charset=utf-8',
          '{"code":"DEV_FIXTURE_METHOD_NOT_ALLOWED"}\n',
          request.method,
        );
        return;
      }

      let pathname;
      try {
        pathname = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}:${port}`).pathname;
      } catch {
        writeResponse(
          response,
          400,
          'application/json; charset=utf-8',
          '{"code":"DEV_FIXTURE_URL_INVALID"}\n',
          request.method,
        );
        return;
      }

      try {
        if (pathname === '/manifest.json') {
          writeResponse(
            response,
            200,
            'application/json; charset=utf-8',
            corpus.manifestBytes,
            request.method,
          );
          return;
        }

        if (pathname.startsWith('/fixtures/')) {
          const encodedName = pathname.slice('/fixtures/'.length);
          let name;
          try {
            name = decodeURIComponent(encodedName);
          } catch {
            writeResponse(
              response,
              400,
              'application/json; charset=utf-8',
              '{"code":"DEV_FIXTURE_PATH_INVALID"}\n',
              request.method,
            );
            return;
          }
          if (name.length === 0 || path.basename(name) !== name || !name.endsWith('.pdf')) {
            writeResponse(
              response,
              400,
              'application/json; charset=utf-8',
              '{"code":"DEV_FIXTURE_PATH_INVALID"}\n',
              request.method,
            );
            return;
          }
          const bytes = corpus.fixtureBytes.get(name);
          if (bytes === undefined) {
            writeResponse(
              response,
              404,
              'application/json; charset=utf-8',
              '{"code":"DEV_FIXTURE_NOT_FOUND"}\n',
              request.method,
            );
            return;
          }
          writeResponse(response, 200, 'application/pdf', bytes, request.method);
          return;
        }

        writeResponse(
          response,
          404,
          'application/json; charset=utf-8',
          '{"code":"DEV_FIXTURE_NOT_FOUND"}\n',
          request.method,
        );
      } catch (error) {
        const status = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' ? 404 : 500;
        const code = status === 404 ? 'DEV_FIXTURE_NOT_FOUND' : 'DEV_FIXTURE_READ_FAILED';
        writeResponse(
          response,
          status,
          'application/json; charset=utf-8',
          `${JSON.stringify({ code })}\n`,
          request.method,
        );
      }
    });
  });

  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.keepAliveTimeout = 2_000;
  server.maxRequestsPerSocket = 100;

  await new Promise(
    /**
     * @param {(value?: void | PromiseLike<void>) => void} resolve
     * @param {(reason?: unknown) => void} reject
     */
    (resolve, reject) => {
      /** @param {Error} error */
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
    },
  );

  return server;
}
