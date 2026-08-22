import { describe, expect, it, beforeEach } from 'vitest'

import type { RecentWorkflowRun } from '../github/data'
import { loadRecentRunsCache, saveRecentRunsCache } from './recentRunsCache'

function aRun(id: number): RecentWorkflowRun {
  return {
    id,
    repoName: 'repo-a',
    workflowName: 'CI',
    displayTitle: 'CI',
    runNumber: id,
    event: 'push',
    headBranch: 'main',
    htmlUrl: `https://example.com/run/${id}`,
    startedAt: '2025-01-01T09:00:00Z',
    completedAt: '2025-01-01T09:10:00Z',
    createdAt: '2025-01-01T09:00:00Z',
    actor: 'alice',
    status: 'completed',
    conclusion: 'success',
    success: true,
  }
}

describe('recentRunsCache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('保存后可读取，且按组织隔离', () => {
    saveRecentRunsCache('acme', [aRun(1)])
    expect(loadRecentRunsCache('acme')?.map((run) => run.id)).toEqual([1])
    // 不同组织互不影响
    expect(loadRecentRunsCache('other')).toBeNull()
  })

  it('组织名大小写/空白归一化', () => {
    saveRecentRunsCache(' Acme ', [aRun(2)])
    expect(loadRecentRunsCache(' acme ')?.map((run) => run.id)).toEqual([2])
  })

  it('无缓存或损坏的缓存返回 null', () => {
    expect(loadRecentRunsCache('acme')).toBeNull()
    localStorage.setItem('orgrepokanban:recent-runs:acme', '{bad json')
    expect(loadRecentRunsCache('acme')).toBeNull()
  })

  it('写入带 savedAt 时间戳（增量合并的时间依据）', () => {
    saveRecentRunsCache('acme', [aRun(1)])
    const raw = localStorage.getItem('orgrepokanban:recent-runs:acme')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(typeof parsed.savedAt).toBe('number')
    expect(parsed.org).toBe('acme')
    expect(parsed.runs).toHaveLength(1)
  })
})
