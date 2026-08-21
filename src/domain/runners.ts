import type {
  GithubRepo,
  OrgRunner,
  QueuedWorkflowRun,
  RecentWorkflowRun,
  RunnerJobInfo,
} from '../github/data'


// ── Runner 看板 ──────────────────────────────────────────────────────────

export interface RunnerColumns {
  idle: OrgRunner[]
  busy: OrgRunner[]
  offline: OrgRunner[]
}

export interface RunnerStats {
  total: number
  idle: number
  busy: number
  offline: number
  online: number
  /** 忙碌 runner 占在线 runner 的比例（0-1），全部离线时为 0 */
  loadRatio: number
}

export function classifyRunners(runners: OrgRunner[]): RunnerColumns {
  const columns: RunnerColumns = { idle: [], busy: [], offline: [] }
  for (const runner of runners) {
    if (runner.status !== 'online') {
      columns.offline.push(runner)
    } else if (runner.busy) {
      columns.busy.push(runner)
    } else {
      columns.idle.push(runner)
    }
  }
  return columns
}

export function runnerStats(runners: OrgRunner[]): RunnerStats {
  let idle = 0
  let busy = 0
  let offline = 0
  for (const runner of runners) {
    if (runner.status !== 'online') {
      offline++
    } else if (runner.busy) {
      busy++
    } else {
      idle++
    }
  }

  const online = idle + busy
  return {
    total: runners.length,
    idle,
    busy,
    offline,
    online,
    loadRatio: online === 0 ? 0 : busy / online,
  }
}

/** 按 runner 名称把「进行中 job」挂到对应忙碌 runner 上；非忙碌 runner 不挂载 */
export function attachCurrentJobs(
  runners: OrgRunner[],
  jobs: RunnerJobInfo[],
): OrgRunner[] {
  const jobByRunner = new Map(jobs.map((job) => [job.runnerName, job]))
  return runners.map((runner) =>
    runner.busy
      ? { ...runner, currentJob: jobByRunner.get(runner.name) ?? null }
      : runner,
  )
}

// ── 队列扫描范围 ─────────────────────────────────────────────────────────

export const RECENT_PUSH_WINDOW_MS = 24 * 60 * 60 * 1000

export function isRecentlyPushed(
  pushedAt: string | null | undefined,
  now: number,
): boolean {
  if (!pushedAt) {
    return false
  }

  const timestamp = Date.parse(pushedAt)
  if (Number.isNaN(timestamp)) {
    return false
  }

  return now - timestamp <= RECENT_PUSH_WINDOW_MS
}

/** 排队 workflow 只可能来自近期有推送的仓库，默认仅扫描 24 小时内推送过的仓库 */
export function selectReposForScan(
  repos: GithubRepo[],
  now: number,
  recentOnly: boolean,
): GithubRepo[] {
  if (!recentOnly) {
    return repos
  }

  return repos.filter((repo) => isRecentlyPushed(repo.pushed_at, now))
}

// ── 排队 run 排序与等待时长 ──────────────────────────────────────────────

export function sortQueuedRuns(runs: QueuedWorkflowRun[]): QueuedWorkflowRun[] {
  return [...runs].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )
}

export function waitMsOf(run: QueuedWorkflowRun, now: number): number {
  const timestamp = Date.parse(run.createdAt)
  if (Number.isNaN(timestamp)) {
    return 0
  }

  return Math.max(0, now - timestamp)
}

export function formatWaitDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours} 小时 ${remainingMinutes} 分`
}

export type WaitTier = 'fresh' | 'warm' | 'hot'

/** 等待 < 1 分钟视为新鲜 */
export const WAIT_TIER_FRESH_MS = 60 * 1000
/** 等待 ≥ 5 分钟视为积压 */
export const WAIT_TIER_HOT_MS = 5 * 60 * 1000

export function waitTierOf(ms: number): WaitTier {
  if (ms < WAIT_TIER_FRESH_MS) {
    return 'fresh'
  }
  if (ms < WAIT_TIER_HOT_MS) {
    return 'warm'
  }
  return 'hot'
}

export function longestWaitMs(runs: QueuedWorkflowRun[], now: number): number {
  let longest = 0
  for (const run of runs) {
    longest = Math.max(longest, waitMsOf(run, now))
  }
  return longest
}

/** 相对最长等待的占比（0-1），用于绘制等待条 */
export function waitRatioOf(
  run: QueuedWorkflowRun,
  now: number,
  longestMs: number,
): number {
  if (longestMs <= 0) {
    return 0
  }

  return Math.min(1, waitMsOf(run, now) / longestMs)
}

// ── 过滤与展示辅助 ───────────────────────────────────────────────────────

export function fuzzyIncludes(target: string, query: string): boolean {
  const normalizedTarget = target.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  if (normalizedTarget.includes(normalizedQuery)) {
    return true
  }

  let pointer = 0
  for (const character of normalizedTarget) {
    if (character === normalizedQuery[pointer]) {
      pointer += 1
      if (pointer === normalizedQuery.length) {
        return true
      }
    }
  }

  return false
}

export function matchesRunFilter(run: QueuedWorkflowRun, query: string): boolean {
  return (
    fuzzyIncludes(run.repoName, query) ||
    fuzzyIncludes(run.name, query) ||
    fuzzyIncludes(run.displayTitle, query) ||
    fuzzyIncludes(run.headBranch, query)
  )
}

export function dedupeLatestWorkflowRuns(runs: RecentWorkflowRun[]): RecentWorkflowRun[] {
  const latestByKey = new Map<string, RecentWorkflowRun>()

  for (const run of runs) {
    const key = `${run.repoName}::${run.workflowName}`
    const current = latestByKey.get(key)
    const currentTime = Date.parse(current?.completedAt ?? current?.startedAt ?? current?.createdAt ?? '0')
    const incomingTime = Date.parse(run.completedAt ?? run.startedAt ?? run.createdAt ?? '0')

    if (!current || incomingTime > currentTime) {
      latestByKey.set(key, run)
    }
  }

  return [...latestByKey.values()].sort((left, right) => {
    const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? left.createdAt)
    const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? right.createdAt)
    return rightTime - leftTime
  })
}

export function filterRecentRunsByStatus(
  runs: RecentWorkflowRun[],
  successOnly: boolean,
): RecentWorkflowRun[] {
  if (!successOnly) {
    return runs
  }

  return runs.filter((run) => run.success)
}

export function mergeRecentRuns(
  current: RecentWorkflowRun[],
  incoming: RecentWorkflowRun[],
): RecentWorkflowRun[] {
  return dedupeLatestWorkflowRuns([...current, ...incoming])
}

const EVENT_LABELS: Record<string, string> = {
  push: '推送',
  pull_request: 'PR',
  schedule: '定时',
  workflow_dispatch: '手动',
  workflow_call: '复用',
  repository_dispatch: '外部',
  release: '发布',
  merge_group: '合并组',
  fork: 'Fork',
}

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

export function osIcon(os: string): string {
  const normalized = os.toLowerCase()
  if (normalized.includes('win')) {
    return '🪟'
  }
  if (normalized.includes('mac')) {
    return '🍎'
  }
  if (normalized.includes('linux')) {
    return '🐧'
  }
  return '💻'
}
