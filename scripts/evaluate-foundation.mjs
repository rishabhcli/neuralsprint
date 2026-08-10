import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const releaseBoundary = JSON.parse(
  await readFile(path.join(root, 'config/release-boundary.json'), 'utf8'),
);
const supportMatrix = await readFile(path.join(root, 'SUPPORT_MATRIX.md'), 'utf8');

const assertions = {
  documentProcessingRefused: releaseBoundary.documentProcessing === 'unavailable',
  noDocumentSafetyClaim: releaseBoundary.documentSafetyClaim === 'none',
  noRuntimeNetworkDependency: releaseBoundary.runtimeNetworkDependencies === 'none',
  productionStatusTruthful: releaseBoundary.productionStatus === 'not-yet-in-production',
  supportMatrixMatches:
    /not (?:yet )?in production/iu.test(supportMatrix) &&
    /No PDF is accepted/iu.test(supportMatrix) &&
    /PDF inspection\s+\| Not implemented/iu.test(supportMatrix),
};

if (Object.values(assertions).some((value) => value !== true)) {
  throw new Error(`FOUNDATION_EVALUATION_FAILED: ${JSON.stringify(assertions)}`);
}

const evidence = {
  schemaVersion: 1,
  command: 'npm run eval',
  seed: 20260809,
  scope: 'tier-0-foundation-contract',
  assertions,
};

await mkdir(path.join(root, 'evidence'), { recursive: true });
await writeFile(
  path.join(root, 'evidence/foundation-evaluation.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { mode: 0o644 },
);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
