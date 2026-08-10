import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const dist = path.join(root, 'dist');
/** @typedef {'cssBytes' | 'javascriptBytes' | 'totalBytes'} BudgetMetric */
/** @type {Readonly<Record<BudgetMetric, number>>} */
const budgets = Object.freeze({
  cssBytes: 50 * 1024,
  javascriptBytes: 200 * 1024,
  totalBytes: 300 * 1024,
});

const distMetadata = await lstat(dist);
if (!distMetadata.isDirectory() || distMetadata.isSymbolicLink()) {
  throw new Error('BUILD_DIST_UNSAFE: dist must be a real directory');
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const results = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`BUILD_SYMLINK_REFUSED: ${absolute}`);
    if (entry.isDirectory()) results.push(...(await walk(absolute)));
    else results.push(absolute);
  }
  return results;
}

const files = await walk(dist);
/** @type {Record<BudgetMetric, number>} */
const sizes = { cssBytes: 0, javascriptBytes: 0, totalBytes: 0 };
for (const file of files) {
  const { size } = await stat(file);
  sizes.totalBytes += size;
  if (file.endsWith('.css')) sizes.cssBytes += size;
  if (file.endsWith('.js')) sizes.javascriptBytes += size;

  if (/\.(?:css|html|js)$/u.test(file)) {
    const contents = await readFile(file, 'utf8');
    if (contents.includes(root)) {
      throw new Error(`BUILD_ABSOLUTE_REPOSITORY_PATH_REFUSED: ${path.relative(dist, file)}`);
    }
    const externalLoad = file.endsWith('.html')
      ? /<(?:img|link|script)\b[^>]*(?:href|src)=["']https?:\/\//iu.test(contents)
      : file.endsWith('.css')
        ? /url\(\s*["']?https?:\/\//iu.test(contents)
        : /(?:fetch|import)\s*\(\s*["'`]https?:\/\//u.test(contents) ||
          /new\s+(?:EventSource|WebSocket)\s*\(\s*["'`]https?:\/\//u.test(contents);
    if (externalLoad) {
      throw new Error(`BUILD_REMOTE_ORIGIN_REFUSED: ${path.relative(dist, file)}`);
    }
  }
}

for (const [metric, budget] of /** @type {[BudgetMetric, number][]} */ (Object.entries(budgets))) {
  if (sizes[metric] > budget) {
    throw new Error(`BUILD_BUDGET_EXCEEDED: ${metric}=${sizes[metric]} budget=${budget}`);
  }
}

process.stdout.write(`build budgets passed: ${JSON.stringify({ budgets, sizes })}\n`);
