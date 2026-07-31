/**
 * Domain types and pure functions for organization secret management.
 *
 * Models:
 *  - OrgSecret: an organisation-level Actions secret (name + metadata only — values are never returned by the API).
 *  - RepoSecretInfo: a repo-level secret name + metadata.
 *  - PendingSecretOp: one queued mutation (set or delete a repo secret).
 *
 * All mutation decisions are captured as PendingSecretOp values; the UI
 * confirms them before the API layer executes them sequentially.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrgSecret {
  name: string
  visibility: 'all' | 'private' | 'selected'
  created_at: string
  updated_at: string
}

export interface RepoSecretInfo {
  name: string
  created_at: string
  updated_at: string
}

export type SecretOpAction = 'set' | 'delete'

export interface PendingSecretOp {
  repoName: string
  secretName: string
  /** Human-readable secret value provided by the user (only used for 'set' ops). */
  value: string
  action: SecretOpAction
}

// ── Summary types for the UI ────────────────────────────────────────────────

export interface SecretSummary {
  name: string
  /** User-supplied plaintext value (empty until the user types one). */
  userValue: string
}

export interface RepoSecretSummary {
  name: string
  fullName: string
  url: string
  /** Secret names already configured on this repo (fetched from GitHub). */
  configuredSecrets: string[]
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Merge an ad-hoc operation into the pending list.
 *
 * Rules:
 *  - If an op for the same repo+secret already exists, replace it.
 *  - A 'delete' op with an empty value is kept; a 'set' op with an empty value
 *    is discarded (no-op).
 *  - If the new op would restore the original state (the secret was already
 *    configured and we are setting the same value), it is dropped — this
 *    function does not know values, so we only drop redundant *delete* ops
 *    where the secret wasn't configured to begin with.
 */
export function addPendingOp(
  ops: PendingSecretOp[],
  repoName: string,
  secretName: string,
  value: string,
  configuredSecrets: string[],
): PendingSecretOp[] {
  const isConfigured = configuredSecrets.includes(secretName)
  const action: SecretOpAction = value.length > 0 ? 'set' : 'delete'

  // Drop no-ops: deleting a secret that was never configured
  if (action === 'delete' && !isConfigured) {
    return ops.filter(
      (op) => !(op.repoName === repoName && op.secretName === secretName),
    )
  }

  const filtered = ops.filter(
    (op) => !(op.repoName === repoName && op.secretName === secretName),
  )

  return [
    ...filtered,
    {
      repoName,
      secretName,
      value,
      action,
    },
  ]
}

/**
 * Remove all pending operations for a given repo.
 */
export function removePendingOpsForRepo(
  ops: PendingSecretOp[],
  repoName: string,
): PendingSecretOp[] {
  return ops.filter((op) => op.repoName !== repoName)
}

/**
 * Remove all pending operations for a given secret across all repos.
 */
export function removePendingOpsForSecret(
  ops: PendingSecretOp[],
  secretName: string,
): PendingSecretOp[] {
  return ops.filter((op) => op.secretName !== secretName)
}

/**
 * Determine the effective list of secret names for a repo after pending ops
 * are applied. Used for optimistic UI updates (tag rendering).
 */
export function effectiveRepoSecrets(
  configuredSecrets: string[],
  pendingOps: PendingSecretOp[],
  repoName: string,
): string[] {
  const setSecrets = new Set(configuredSecrets)

  for (const op of pendingOps) {
    if (op.repoName !== repoName) continue

    if (op.action === 'set') {
      setSecrets.add(op.secretName)
    } else if (op.action === 'delete') {
      setSecrets.delete(op.secretName)
    }
  }

  return Array.from(setSecrets).sort()
}

/**
 * Format a pending op into a human-readable description (Chinese).
 */
export function formatPendingOp(op: PendingSecretOp): string {
  if (op.action === 'delete') {
    return `在 ${op.repoName} 删除 secret「${op.secretName}」`
  }

  return `在 ${op.repoName} 设置 secret「${op.secretName}」`
}

/**
 * Check whether two pending-op lists are semantically equal.
 */
export function pendingOpsEqual(
  a: PendingSecretOp[],
  b: PendingSecretOp[],
): boolean {
  if (a.length !== b.length) return false

  const key = (op: PendingSecretOp) =>
    `${op.repoName}::${op.secretName}::${op.action}::${op.value}`

  const aSet = new Set(a.map(key))
  return b.every((op) => aSet.has(key(op)))
}
