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

/** 排除 GitHub Copilot review/code agent 使用的托管 Runner。 */
export function isCopilotRunner(runner: OrgRunner): boolean {
  const searchableText = [runner.name, ...runner.labels.map((label) => label.name)]
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')

  return /\bcopilot\b|\breview\b|\bcode\s+(?:agent|review)\b/.test(searchableText)
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

/**
 * 排队 run 的本地排序方式：仅对当前已加载的数据重排，不发起任何网络请求。
 * - wait：等待时长最久优先（createdAt 升序），默认值，与 sortQueuedRuns 行为一致
 * - created：触发时间最新优先（createdAt 降序）
 * - repo：仓库名 A→Z（localeCompare）
 * - branch：分支名 A→Z（localeCompare；headBranch 为空串时视为最小、排最前）
 *
 * 稳定性说明：ES2019 起 Array.prototype.sort 规范要求稳定排序，
 * V8 等现代 JS 引擎均已满足，同 key 元素保持原相对顺序。
 */
export type QueueSortMode = 'wait' | 'created' | 'repo' | 'branch'

export function sortQueuedRunsBy(
  runs: QueuedWorkflowRun[],
  mode: QueueSortMode,
): QueuedWorkflowRun[] {
  switch (mode) {
    case 'created':
      return [...runs].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )
    case 'repo':
      return [...runs].sort((left, right) => left.repoName.localeCompare(right.repoName))
    case 'branch':
      return [...runs].sort((left, right) =>
        (left.headBranch || '').localeCompare(right.headBranch || ''),
      )
    case 'wait':
    default:
      // 默认值：复用现有 sortQueuedRuns，保证默认视图行为不变
      return sortQueuedRuns(runs)
  }
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

// ── 排队 run 分支存在性检查辅助 ──────────────────────────────────────────

/** 分支存在性检查的去重键：同一 (仓库, 分支) 只检查一次 */
export function branchCheckKey(repoName: string, branch: string): string {
  return `${repoName}::${branch}`
}

/** 排队 run 中需要检查分支存在性的唯一 (仓库, 分支) 列表；空分支跳过（视为存在，不检查） */
export function uniqueBranchCheckKeys(
  runs: QueuedWorkflowRun[],
): Array<{ repoName: string; branch: string; key: string }> {
  const seen = new Set<string>()
  const keys: Array<{ repoName: string; branch: string; key: string }> = []
  for (const run of runs) {
    if (!run.headBranch) {
      continue
    }
    const key = branchCheckKey(run.repoName, run.headBranch)
    if (!seen.has(key)) {
      seen.add(key)
      keys.push({ repoName: run.repoName, branch: run.headBranch, key })
    }
  }
  return keys
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

export function matchesRecentRunFilter(run: RecentWorkflowRun, query: string): boolean {
  return (
    fuzzyIncludes(run.repoName, query) ||
    fuzzyIncludes(run.workflowName, query) ||
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

/**
 * 最近运行记录的状态过滤：nonSuccessOnly=true 时仅保留「非成功」记录
 * （失败 / 已取消 / 超时等 success=false 的完成记录，以及运行中 success=false 的记录），
 * 成功的 workflow 不需要关注，因此默认不勾选展示全部。
 */
export function filterRecentRunsByStatus(
  runs: RecentWorkflowRun[],
  nonSuccessOnly: boolean,
): RecentWorkflowRun[] {
  if (!nonSuccessOnly) {
    return runs
  }

  return runs.filter((run) => !run.success)
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
