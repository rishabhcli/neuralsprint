/**
 * @typedef {{ hasInstallScript?: unknown, version?: unknown } | null} LockPackageMetadata
 * @typedef {{ packages?: Record<string, LockPackageMetadata> } | null} PackageLock
 * @typedef {{ allowScripts?: Record<string, unknown> | null } | null | undefined} PackageJson
 */

/**
 * @param {PackageLock} packageLock
 * @returns {Set<string>}
 */
export function collectInstallScriptPackages(packageLock) {
  if (
    packageLock === null ||
    typeof packageLock !== 'object' ||
    packageLock.packages === null ||
    typeof packageLock.packages !== 'object'
  ) {
    throw new Error('DEPENDENCY_LOCK_INVALID: package-lock.json packages map is required');
  }

  const identities = new Set();
  for (const [lockPath, metadata] of Object.entries(packageLock.packages)) {
    if (lockPath === '' || metadata?.hasInstallScript !== true) continue;
    const marker = 'node_modules/';
    const markerIndex = lockPath.lastIndexOf(marker);
    if (markerIndex < 0 || typeof metadata.version !== 'string') {
      throw new Error(`DEPENDENCY_INSTALL_SCRIPT_IDENTITY_INVALID: ${lockPath}`);
    }
    const name = lockPath.slice(markerIndex + marker.length);
    identities.add(`${name}@${metadata.version}`);
  }
  return identities;
}

/**
 * @param {PackageJson} packageJson
 * @param {ReadonlySet<string>} installScriptPackages
 * @returns {Record<string, unknown>}
 */
export function validateInstallScriptPolicy(packageJson, installScriptPackages) {
  const policy = packageJson?.allowScripts;
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(
      'DEPENDENCY_INSTALL_SCRIPT_POLICY_MISSING: package.json allowScripts is required',
    );
  }

  const declared = new Set(Object.keys(policy));
  const unreviewed = [...installScriptPackages].filter((identity) => {
    const separator = identity.lastIndexOf('@');
    const name = identity.slice(0, separator);
    return !declared.has(identity) && !declared.has(name);
  });
  const stale = [...declared].filter(
    (entry) =>
      !installScriptPackages.has(entry) &&
      ![...installScriptPackages].some((identity) => identity.startsWith(`${entry}@`)),
  );
  if (unreviewed.length > 0 || stale.length > 0) {
    throw new Error(
      `DEPENDENCY_INSTALL_SCRIPT_POLICY_DRIFT: unreviewed=${unreviewed.join(',') || 'none'} stale=${stale.join(',') || 'none'}`,
    );
  }

  for (const [entry, decision] of Object.entries(policy)) {
    if (typeof decision !== 'boolean') {
      throw new Error(`DEPENDENCY_INSTALL_SCRIPT_POLICY_INVALID: ${entry} must be true or false`);
    }
    if (decision && !installScriptPackages.has(entry)) {
      throw new Error(
        `DEPENDENCY_INSTALL_SCRIPT_POLICY_TOO_BROAD: approvals must pin an exact package version (${entry})`,
      );
    }
  }

  return Object.fromEntries([...declared].sort().map((entry) => [entry, policy[entry]]));
}
