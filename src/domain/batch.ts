import type { PermissionLevel } from './permissions'

export interface BatchResult {
  repo: string
  success: boolean
  error?: string
}

export interface BatchReconcileResult {
  next: Record<string, PermissionLevel>
  success: string[]
  failed: Array<{ repo: string; error: string }>
}

export function applyOptimisticPermission(
  current: Record<string, PermissionLevel>,
  repoNames: string[],
  target: PermissionLevel,
): Record<string, PermissionLevel> {
  const next: Record<string, PermissionLevel> = { ...current }
  for (const repoName of repoNames) {
    next[repoName] = target
  }

  return next
}

export function reconcileBatchResults(
  previous: Record<string, PermissionLevel>,
  optimistic: Record<string, PermissionLevel>,
  results: BatchResult[],
): BatchReconcileResult {
  const next: Record<string, PermissionLevel> = { ...optimistic }
  const success: string[] = []
  const failed: Array<{ repo: string; error: string }> = []

  for (const result of results) {
    if (result.success) {
      success.push(result.repo)
      continue
    }

    next[result.repo] = previous[result.repo] ?? 'none'
    failed.push({
      repo: result.repo,
      error: result.error ?? '未知错误',
    })
  }

  return {
    next,
    success,
    failed,
  }
}
