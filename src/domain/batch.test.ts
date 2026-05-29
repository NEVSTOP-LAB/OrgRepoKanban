import { describe, expect, it } from 'vitest'

import type { PermissionLevel } from './permissions'
import {
  applyOptimisticPermission,
  reconcileBatchResults,
  type BatchResult,
} from './batch'

describe('applyOptimisticPermission', () => {
  it('updates all selected repositories to the target permission', () => {
    const current: Record<string, PermissionLevel> = {
      'repo-a': 'pull',
      'repo-b': 'none',
      'repo-c': 'push',
    }

    const next = applyOptimisticPermission(current, ['repo-a', 'repo-b'], 'maintain')

    expect(next['repo-a']).toBe('maintain')
    expect(next['repo-b']).toBe('maintain')
    expect(next['repo-c']).toBe('push')
  })
})

describe('reconcileBatchResults', () => {
  it('rolls back failed repositories while keeping successful ones', () => {
    const before: Record<string, PermissionLevel> = {
      'repo-a': 'pull',
      'repo-b': 'none',
      'repo-c': 'push',
    }

    const optimistic = applyOptimisticPermission(before, ['repo-a', 'repo-b'], 'admin')
    const results: BatchResult[] = [
      { repo: 'repo-a', success: true },
      { repo: 'repo-b', success: false, error: 'Forbidden' },
    ]

    const settled = reconcileBatchResults(before, optimistic, results)

    expect(settled.next['repo-a']).toBe('admin')
    expect(settled.next['repo-b']).toBe('none')
    expect(settled.success).toEqual(['repo-a'])
    expect(settled.failed).toEqual([{ repo: 'repo-b', error: 'Forbidden' }])
  })
})
