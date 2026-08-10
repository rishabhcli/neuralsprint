import { sha256Hex, validateFixtureManifest } from './fixture-corpus.mjs';
import { LOOPBACK_HOST, READY_PATH, SERVICE_SPECS, serviceSpec } from './dev-contract.mjs';
import { validateReadyDocument } from './service-health.mjs';

/**
 * @typedef {keyof typeof SERVICE_SPECS} ServiceName
 * @typedef {Readonly<{ name: string, status: 'pass' }>} ReadyCheck
 * @typedef {Readonly<{ response: Response, bytes: Uint8Array }>} BoundedResponse
 */

const MAX_HEALTH_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * @param {ServiceName} service
 * @returns {string}
 */
function serviceOrigin(service) {
  return `http://${LOOPBACK_HOST}:${serviceSpec(service).port}`;
}

/**
 * @param {string | URL} url
 * @param {{ maxBytes: number, headers?: RequestInit['headers'], method?: string }} options
 * @returns {Promise<BoundedResponse>}
 */
async function fetchBounded(url, { maxBytes, headers = undefined, method = 'GET' }) {
  const response = await fetch(
    url,
    /** @type {RequestInit} */ ({
      headers,
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`DEV_HTTP_STATUS_INVALID: ${url} returned ${response.status}`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new Error(`DEV_HTTP_BODY_TOO_LARGE: ${url} exceeded ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (reader === undefined) return { response, bytes: new Uint8Array() };
  /** @type {Uint8Array[]} */
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new Error(`DEV_HTTP_BODY_TOO_LARGE: ${url} exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { response, bytes };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * @param {'app-dev' | 'playwright'} service
 * @returns {Promise<readonly ReadyCheck[]>}
 */
async function probeViteDevelopment(service) {
  const origin = serviceOrigin(service);
  const root = await fetchBounded(`${origin}/`, { maxBytes: MAX_HTML_BYTES });
  const html = decodeUtf8(root.bytes);
  if (
    !root.response.headers.get('content-type')?.startsWith('text/html') ||
    !html.includes('<div id="root"></div>') ||
    !html.includes('/src/main.tsx')
  ) {
    throw new Error(`DEV_APP_ENTRY_INVALID: ${service} did not serve the app entry HTML`);
  }

  const entry = await fetchBounded(`${origin}/src/main.tsx`, { maxBytes: MAX_ASSET_BYTES });
  const transformedEntry = decodeUtf8(entry.bytes);
  const contentType = entry.response.headers.get('content-type') ?? '';
  if (
    !contentType.includes('javascript') ||
    (!transformedEntry.includes('createRoot') && !transformedEntry.includes('FoundationStatus'))
  ) {
    throw new Error(`DEV_APP_TRANSFORM_INVALID: ${service} could not transform the app entry`);
  }

  return Object.freeze([
    Object.freeze({ name: 'app-html', status: 'pass' }),
    Object.freeze({ name: 'module-transform', status: 'pass' }),
  ]);
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function localAssetPaths(html) {
  const matches = html.matchAll(/(?:src|href)=["'](\/assets\/[A-Za-z0-9._/-]+)["']/gu);
  return [...new Set([...matches].map((match) => /** @type {string} */ (match[1])))];
}

/** @returns {Promise<readonly ReadyCheck[]>} */
async function probePreview() {
  const origin = serviceOrigin('preview');
  const root = await fetchBounded(`${origin}/`, { maxBytes: MAX_HTML_BYTES });
  const html = decodeUtf8(root.bytes);
  const assets = localAssetPaths(html);
  if (
    !root.response.headers.get('content-type')?.startsWith('text/html') ||
    !html.includes('<div id="root"></div>') ||
    assets.length < 1 ||
    !assets.some((asset) => asset.endsWith('.js'))
  ) {
    throw new Error('DEV_PREVIEW_ENTRY_INVALID: preview did not serve a built app entry');
  }

  for (const asset of assets) {
    await fetchBounded(`${origin}${asset}`, { maxBytes: MAX_ASSET_BYTES });
  }

  return Object.freeze([
    Object.freeze({ name: 'built-app-html', status: 'pass' }),
    Object.freeze({ name: 'built-assets', status: 'pass' }),
  ]);
}

/** @returns {Promise<readonly ReadyCheck[]>} */
async function probeFixtures() {
  const origin = serviceOrigin('fixtures');
  const manifestResponse = await fetchBounded(`${origin}/manifest.json`, {
    maxBytes: MAX_HEALTH_BYTES,
  });
  const manifest = validateFixtureManifest(JSON.parse(decodeUtf8(manifestResponse.bytes)));
  const fixture = /** @type {(typeof manifest.fixtures)[number]} */ (manifest.fixtures[0]);
  const pdfResponse = await fetchBounded(`${origin}/fixtures/${encodeURIComponent(fixture.file)}`, {
    maxBytes: MAX_ASSET_BYTES,
  });
  if (
    pdfResponse.response.headers.get('content-type') !== 'application/pdf' ||
    pdfResponse.bytes.byteLength !== fixture.bytes ||
    sha256Hex(pdfResponse.bytes) !== fixture.sha256 ||
    !decodeUtf8(pdfResponse.bytes.subarray(0, 8)).startsWith('%PDF-1.')
  ) {
    throw new Error('DEV_FIXTURE_PROBE_INVALID: served PDF does not match the manifest');
  }

  return Object.freeze([
    Object.freeze({ name: 'fixture-manifest', status: 'pass' }),
    Object.freeze({ name: 'fixture-pdf-integrity', status: 'pass' }),
  ]);
}

/**
 * @param {unknown} service
 * @returns {Promise<readonly ReadyCheck[]>}
 */
export async function probeSemanticSurface(service) {
  if (service === 'app-dev' || service === 'playwright') {
    return probeViteDevelopment(service);
  }
  if (service === 'preview') return probePreview();
  if (service === 'fixtures') return probeFixtures();
  throw new Error(`DEV_SERVICE_UNKNOWN: cannot probe ${String(service)}`);
}

/** @param {ServiceName} service */
export async function probeReadyEndpoint(service) {
  const spec = serviceSpec(service);
  const result = await fetchBounded(`${serviceOrigin(service)}${READY_PATH}`, {
    maxBytes: MAX_HEALTH_BYTES,
  });
  const contentType = result.response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new Error(`DEV_READINESS_INVALID: ${service} readiness is not JSON`);
  }
  return validateReadyDocument(JSON.parse(decodeUtf8(result.bytes)), service, spec.port);
}

/** @param {ServiceName} service */
export async function probeServiceHealth(service) {
  await probeReadyEndpoint(service);
  await probeSemanticSurface(service);
  return Object.freeze({ service, port: SERVICE_SPECS[service].port, status: 'ready' });
}
