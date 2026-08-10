import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');

/** @typedef {'parser' | 'interpreter' | 'findings' | 'sanitizer' | 'verifier' | 'ui'} Owner */

/** @type {readonly (readonly [string, Owner])[]} */
const ownerPrefixes = [
  ['pdf/parser', 'parser'],
  ['pdf/interpreter', 'interpreter'],
  ['findings', 'findings'],
  ['sanitizer', 'sanitizer'],
  ['verifier', 'verifier'],
  ['ui', 'ui'],
];

/** @type {Map<Owner, ReadonlySet<Owner>>} */
const allowedOwnerDependencies = new Map(
  /** @type {Array<readonly [Owner, ReadonlySet<Owner>]>} */ ([
    ['parser', new Set(['parser'])],
    ['interpreter', new Set(['parser', 'interpreter'])],
    ['findings', new Set(['parser', 'interpreter', 'findings'])],
    ['sanitizer', new Set(['parser', 'interpreter', 'findings', 'sanitizer'])],
    ['verifier', new Set(['parser', 'interpreter', 'findings', 'verifier'])],
  ]),
);

const domainOwners = new Set(allowedOwnerDependencies.keys());

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
    if (entry.isDirectory()) results.push(...(await walk(absolute)));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) results.push(absolute);
  }
  return results;
}

/**
 * @param {string} absolutePath
 * @param {string} [owningSourceRoot]
 * @returns {Owner | undefined}
 */
function ownerFor(absolutePath, owningSourceRoot = sourceRoot) {
  const relative = path.relative(owningSourceRoot, absolutePath).split(path.sep).join('/');
  return ownerPrefixes.find(
    ([prefix]) => relative === prefix || relative.startsWith(`${prefix}/`),
  )?.[1];
}

/**
 * @param {import('typescript').SourceFile} sourceFile
 * @returns {string[]}
 */
function importedSpecifiers(sourceFile) {
  /** @type {string[]} */
  const specifiers = [];
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(/** @type {import('typescript').Expression} */ (node.arguments[0]))
    ) {
      specifiers.push(/** @type {import('typescript').StringLiteral} */ (node.arguments[0]).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/**
 * @param {string} file
 * @param {string} source
 * @param {string} [owningSourceRoot]
 * @returns {string[]}
 */
function inspectSource(file, source, owningSourceRoot = sourceRoot) {
  const owner = ownerFor(file, owningSourceRoot);
  if (owner === undefined || !domainOwners.has(owner)) return [];

  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  /** @type {string[]} */
  const violations = [];
  for (const specifier of importedSpecifiers(parsed)) {
    if (!specifier.startsWith('.')) {
      violations.push(
        `${path.relative(root, file)}: domain owner ${owner} cannot import external package ${specifier}`,
      );
      continue;
    }

    const target = path.resolve(path.dirname(file), specifier);
    const relativeTarget = path.relative(owningSourceRoot, target);
    if (relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      violations.push(
        `${path.relative(root, file)}: domain owner ${owner} cannot escape src (${specifier})`,
      );
      continue;
    }

    const targetOwner = ownerFor(target, owningSourceRoot);
    if (targetOwner === undefined) {
      violations.push(
        `${path.relative(root, file)}: domain owner ${owner} cannot import unowned source (${specifier})`,
      );
      continue;
    }
    if (!allowedOwnerDependencies.get(owner)?.has(targetOwner)) {
      violations.push(
        `${path.relative(root, file)}: ${owner} cannot import ownership area ${targetOwner} (${specifier})`,
      );
    }
  }
  return violations;
}

const selfTests = [
  {
    file: path.join(sourceRoot, 'pdf/parser/external.ts'),
    source: "import React from 'react';",
    expected: 'cannot import external package react',
  },
  {
    file: path.join(sourceRoot, 'pdf/parser/ui.ts'),
    source: "import '../../ui/FoundationStatus.js';",
    expected: 'cannot import ownership area ui',
  },
  {
    file: path.join(sourceRoot, 'pdf/parser/unowned.ts'),
    source: "import '../../main.js';",
    expected: 'cannot import unowned source',
  },
  {
    file: path.join(sourceRoot, 'verifier/sanitizer.ts'),
    source: "import '../sanitizer/index.js';",
    expected: 'cannot import ownership area sanitizer',
  },
  {
    file: path.join(sourceRoot, 'sanitizer/allowed.ts'),
    source: "import '../findings/index.js';",
    expected: undefined,
  },
];

for (const selfTest of selfTests) {
  const result = inspectSource(selfTest.file, selfTest.source);
  const passed =
    selfTest.expected === undefined
      ? result.length === 0
      : result.some((violation) => violation.includes(selfTest.expected));
  if (!passed) {
    throw new Error(
      `BOUNDARY_SELF_TEST_FAILED: ${path.basename(selfTest.file)} expected ${String(selfTest.expected)}, received ${result.join('; ') || 'no violation'}`,
    );
  }
}

const files = await walk(sourceRoot);
if (files.length === 0) throw new Error('BOUNDARY_SOURCE_EMPTY: no TypeScript source files found');

/** @type {string[]} */
const violations = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  violations.push(...inspectSource(file, source));
}

if (violations.length > 0) {
  throw new Error(`BOUNDARY_VIOLATION:\n${violations.map((item) => `- ${item}`).join('\n')}`);
}

process.stdout.write(
  `boundary check passed: ${files.length} TypeScript source files inspected; ${selfTests.length} policy self-tests passed\n`,
);
