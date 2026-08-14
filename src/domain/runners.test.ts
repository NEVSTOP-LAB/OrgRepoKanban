import { describe, expect, it } from 'vitest'

import type { OrgRunner, QueuedWorkflowRun } from '../github/data'
import {
  classifyRunners,
  eventLabel,
  formatWaitDuration,
  fuzzyIncludes,
  isRecentlyPushed,
  longestWaitMs,
  matchesRunFilter,
  osIcon,
  runnerStats,
  selectReposForScan,
  sortQueuedRuns,
  waitMsOf,
  waitRatioOf,
  waitTierOf,
} from './runners'

function makeRunner(overrides: Partial<OrgRunner> = {}): OrgRunner {
  return {
    id: 1,
    name: 'linux-runner-1',
    os: 'linux',
    status: 'online',
    busy: false,
    labels: [{ id: 1, name: 'self-hosted' }],
    ...overrides,
  }
}

function makeRun(overrides: Partial<QueuedWorkflowRun> = {}): QueuedWorkflowRun {
  return {
    id: 1,
    repoName: 'repo-a',
    name: 'CI',
    displayTitle: 'CI',
    runNumber: 42,
    event: 'push',
    headBranch: 'main',
    headSha: 'abc123',
    htmlUrl: 'https://github.com/acme/repo-a/actions/runs/1',
    createdAt: '2025-01-01T10:00:00Z',
    actor: 'alice',
    ...overrides,
  }
}

describe('classifyRunners', () => {
  it('按 空闲/忙碌/离线 三列分类', () => {
    const runners = [
      makeRunner({ id: 1, status: 'online', busy: false }),
      makeRunner({ id: 2, status: 'online', busy: true }),
      makeRunner({ id: 3, status: 'offline', busy: false }),
      makeRunner({ id: 4, status: 'offline', busy: true }),
    ]

    const columns = classifyRunners(runners)
    expect(columns.idle.map((r) => r.id)).toEqual([1])
    expect(columns.busy.map((r) => r.id)).toEqual([2])
    expect(columns.offline.map((r) => r.id)).toEqual([3, 4])
  })

  it('空列表返回三列空数组', () => {
    expect(classifyRunners([])).toEqual({ idle: [], busy: [], offline: [] })
  })
})

describe('runnerStats', () => {
  it('统计总数与负载比例', () => {
    const stats = runnerStats([
      makeRunner({ id: 1, busy: false }),
      makeRunner({ id: 2, busy: true }),
      makeRunner({ id: 3, status: 'offline' }),
    ])

    expect(stats).toMatchObject({ total: 3, idle: 1, busy: 1, offline: 1, online: 2 })
    expect(stats.loadRatio).toBeCloseTo(0.5)
  })

  it('全部离线时负载比例为 0', () => {
    const stats = runnerStats([makeRunner({ status: 'offline' })])
    expect(stats.loadRatio).toBe(0)
  })
})

describe('isRecentlyPushed', () => {
  const now = Date.parse('2025-01-02T12:00:00Z')

  it('24 小时内的推送返回 true', () => {
    expect(isRecentlyPushed('2025-01-02T06:00:00Z', now)).toBe(true)
  })

  it('超过 24 小时的推送返回 false', () => {
    expect(isRecentlyPushed('2025-01-01T06:00:00Z', now)).toBe(false)
  })

  it('缺失或非法时间返回 false', () => {
    expect(isRecentlyPushed(null, now)).toBe(false)
    expect(isRecentlyPushed(undefined, now)).toBe(false)
    expect(isRecentlyPushed('not-a-date', now)).toBe(false)
  })
})

describe('selectReposForScan', () => {
  const now = Date.parse('2025-01-02T12:00:00Z')
  const repos = [
    { id: 1, name: 'fresh', full_name: 'acme/fresh', html_url: '', pushed_at: '2025-01-02T06:00:00Z' },
    { id: 2, name: 'stale', full_name: 'acme/stale', html_url: '', pushed_at: '2025-01-01T06:00:00Z' },
    { id: 3, name: 'never', full_name: 'acme/never', html_url: '', pushed_at: null },
  ]

  it('recentOnly 为 true 时仅保留 24 小时内推送过的仓库', () => {
    expect(selectReposForScan(repos, now, true).map((r) => r.name)).toEqual(['fresh'])
  })

  it('recentOnly 为 false 时返回全部仓库', () => {
    expect(selectReposForScan(repos, now, false)).toHaveLength(3)
  })
})

describe('sortQueuedRuns', () => {
  it('按创建时间升序（等待最久在前）', () => {
    const runs = [
      makeRun({ id: 2, createdAt: '2025-01-01T10:05:00Z' }),
      makeRun({ id: 1, createdAt: '2025-01-01T10:00:00Z' }),
    ]

    expect(sortQueuedRuns(runs).map((r) => r.id)).toEqual([1, 2])
  })

  it('不修改原数组', () => {
    const runs = [makeRun({ id: 1 })]
    sortQueuedRuns(runs)
    expect(runs).toHaveLength(1)
  })
})

describe('waitMsOf / formatWaitDuration / waitTierOf', () => {
  const now = Date.parse('2025-01-01T10:05:00Z')

  it('计算等待毫秒数', () => {
    const run = makeRun({ createdAt: '2025-01-01T10:00:00Z' })
    expect(waitMsOf(run, now)).toBe(5 * 60 * 1000)
  })

  it('非法时间等待为 0', () => {
    expect(waitMsOf(makeRun({ createdAt: 'bad' }), now)).toBe(0)
  })

  it('格式化等待时长', () => {
    expect(formatWaitDuration(42 * 1000)).toBe('42 秒')
    expect(formatWaitDuration(3 * 60 * 1000 + 12 * 1000)).toBe('3 分 12 秒')
    expect(formatWaitDuration(2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe('2 小时 5 分')
  })

  it('等待分级：fresh / warm / hot', () => {
    expect(waitTierOf(30 * 1000)).toBe('fresh')
    expect(waitTierOf(3 * 60 * 1000)).toBe('warm')
    expect(waitTierOf(6 * 60 * 1000)).toBe('hot')
  })
})

describe('longestWaitMs / waitRatioOf', () => {
  const now = Date.parse('2025-01-01T10:10:00Z')

  it('返回最长等待毫秒数', () => {
    const runs = [
      makeRun({ id: 1, createdAt: '2025-01-01T10:00:00Z' }),
      makeRun({ id: 2, createdAt: '2025-01-01T10:05:00Z' }),
    ]
    expect(longestWaitMs(runs, now)).toBe(10 * 60 * 1000)
  })

  it('空列表最长等待为 0', () => {
    expect(longestWaitMs([], now)).toBe(0)
  })

  it('计算相对占比且不超过 1', () => {
    const run = makeRun({ createdAt: '2025-01-01T10:05:00Z' })
    expect(waitRatioOf(run, now, 10 * 60 * 1000)).toBeCloseTo(0.5)
    expect(waitRatioOf(run, now, 0)).toBe(0)
    expect(waitRatioOf(run, now, 1000)).toBe(1)
  })
})

describe('fuzzyIncludes / matchesRunFilter', () => {
  it('包含与顺序模糊匹配', () => {
    expect(fuzzyIncludes('my-repo', 'repo')).toBe(true)
    expect(fuzzyIncludes('my-repo', 'mrp')).toBe(true)
    expect(fuzzyIncludes('my-repo', 'zzz')).toBe(false)
  })

  it('空查询匹配所有', () => {
    expect(fuzzyIncludes('anything', '')).toBe(true)
    expect(fuzzyIncludes('anything', '   ')).toBe(true)
  })

  it('run 过滤覆盖仓库名、workflow 名与分支', () => {
    const run = makeRun({ repoName: 'svc-api', name: 'Deploy', headBranch: 'release/1.0' })
    expect(matchesRunFilter(run, 'api')).toBe(true)
    expect(matchesRunFilter(run, 'deploy')).toBe(true)
    expect(matchesRunFilter(run, 'release')).toBe(true)
    expect(matchesRunFilter(run, 'ghost')).toBe(false)
  })
})

describe('eventLabel / osIcon', () => {
  it('事件中文标签', () => {
    expect(eventLabel('push')).toBe('推送')
    expect(eventLabel('pull_request')).toBe('PR')
    expect(eventLabel('unknown-event')).toBe('unknown-event')
  })

  it('操作系统图标', () => {
    expect(osIcon('linux')).toBe('🐧')
    expect(osIcon('Windows')).toBe('🪟')
    expect(osIcon('macOS')).toBe('🍎')
    expect(osIcon('weird-os')).toBe('💻')
  })
})