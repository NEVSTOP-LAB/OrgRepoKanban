import { useCallback, useEffect, useRef, useState } from 'react'

import { GithubClient, isRateLimitedError } from '../github/client'
import type { GithubRepo, OrgRunner, QueuedWorkflowRun, RecentWorkflowRun, RunnerJobInfo } from '../github/data'
import {
  attachCurrentJobs,
  classifyRunners,
  dedupeLatestWorkflowRuns,
  eventLabel,
  filterRecentRunsByStatus,
  formatWaitDuration,
  isCopilotRunner,
  longestWaitMs,
  matchesRecentRunFilter,
  mergeRecentRuns,
  osIcon,
  runnerStats,
  selectReposForScan,
  sortQueuedRuns,
  waitMsOf,
  waitRatioOf,
  waitTierOf,
} from '../domain/runners'

// ── 类型与常量 ───────────────────────────────────────────────────────────

interface Notice {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
}

const RUNNER_COLUMNS = [
  { key: 'idle', title: '空闲', icon: '🟢', hint: '在线待命，可立即接单' },
  { key: 'busy', title: '忙碌', icon: '🔵', hint: '正在执行 job' },
  { key: 'offline', title: '离线', icon: '⚫', hint: '未连接到 GitHub' },
] as const

const AUTO_REFRESH_OPTIONS = [
  { seconds: 30, label: '30 秒' },
  { seconds: 60, label: '1 分钟' },
  { seconds: 180, label: '3 分钟' },
  { seconds: 300, label: '5 分钟' },
]

/** 自动刷新默认周期：3 分钟 */
const DEFAULT_AUTO_REFRESH_SECONDS = 180

const MAX_RUNNER_LABELS = 4

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

// ── 组件 ─────────────────────────────────────────────────────────────────

export interface RunnerBoardProps {
  client: GithubClient
  org: string
  onBack: () => void
}

export function RunnerBoard({ client, org, onBack }: RunnerBoardProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // 数据状态
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [runners, setRunners] = useState<OrgRunner[]>([])
  const [runnersUnavailable, setRunnersUnavailable] = useState(false)
  const [queuedRuns, setQueuedRuns] = useState<QueuedWorkflowRun[]>([])
  const [recentRuns, setRecentRuns] = useState<RecentWorkflowRun[]>([])
  const [recentProgress, setRecentProgress] = useState<{ completed: number; total: number } | null>(null)
  const [scanProgress, setScanProgress] = useState<{ completed: number; total: number } | null>(null)
  const [skippedRepos, setSkippedRepos] = useState(0)
  const [scanFailures, setScanFailures] = useState(0)

  // 视图选项
  const [recentOnly, setRecentOnly] = useState(true)
  const [recentSuccessOnly, setRecentSuccessOnly] = useState(false)
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(DEFAULT_AUTO_REFRESH_SECONDS)
  const [filterQuery, setFilterQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const scanEpochRef = useRef(0)
  const refreshingRef = useRef(false)
  const recentOnlyRef = useRef(true)
  const recentRunsRef = useRef<RecentWorkflowRun[]>([])

  useEffect(() => {
    recentRunsRef.current = recentRuns
  }, [recentRuns])

  // ── 数据加载 ─────────────────────────────────────────────────────────

  const scanQueued = useCallback(async (
    activeClient: GithubClient,
    repoList: GithubRepo[],
    epoch: number,
    runnerNames: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> => {
    const targets = selectReposForScan(repoList, Date.now(), recentOnlyRef.current)
    const collected: QueuedWorkflowRun[] = []
    const busyJobs: RunnerJobInfo[] = []
    let skipped = 0
    let failed = 0
    let completed = 0
    const queue = [...targets]
    const CONCURRENCY = 8

    setScanProgress({ completed: 0, total: targets.length })
    setSkippedRepos(0)
    setScanFailures(0)
    // 开始新一轮扫描前先清空旧队列：targets 为空时也不残留上一轮结果
    setQueuedRuns([])

    const worker = async () => {
      while (queue.length > 0) {
        const repo = queue.shift()!
        try {
          const [queued, jobs] = await Promise.all([
            activeClient.listQueuedWorkflowRuns(repo.name),
            activeClient.listBusyRunnerJobs(repo.name, runnerNames),
          ])
          if (queued === null) {
            // 仓库不可读（未启用 Actions / 无权限 / 不存在）
            skipped += 1
          } else {
            collected.push(...queued)
          }
          if (jobs !== null) {
            busyJobs.push(...jobs)
          }
        } catch {
          // 限流 / 5xx / 网络错误：计入扫描失败，与「仓库不可读」区分展示
          failed += 1
        }

        completed += 1
        if (epoch === scanEpochRef.current) {
          setQueuedRuns(sortQueuedRuns([...collected]))
          setSkippedRepos(skipped)
          setScanFailures(failed)
          setScanProgress({ completed, total: targets.length })
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()))
    if (epoch === scanEpochRef.current) {
      setScanProgress(null)
      // 把匹配到的「进行中 job」挂到对应忙碌 runner 上，用于显示当前 workflow 链接
      setRunners((prev) => attachCurrentJobs(prev, busyJobs))
    }

    return new Set([
      ...collected.map((run) => run.repoName),
      ...busyJobs.map((job) => job.repoName),
    ])
  }, [])

  const refreshRecentRuns = useCallback(async (
    activeClient: GithubClient,
    repoList: GithubRepo[],
    repoNames?: ReadonlySet<string>,
  ) => {
    const targets = selectReposForScan(repoList, Date.now(), recentOnlyRef.current)
      .filter((repo) => repoNames === undefined || repoNames.has(repo.name))
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    let completed = 0

    if (repoNames === undefined) {
      setRecentRuns([])
    }
    setRecentProgress({ completed: 0, total: targets.length })

    for (const repo of targets) {
      try {
        const runs = await activeClient.listRecentWorkflowRuns(repo.name)
        if (runs) {
          setRecentRuns((prev) =>
            mergeRecentRuns(
              repoNames === undefined ? prev : prev.filter((run) => run.repoName !== repo.name),
              dedupeLatestWorkflowRuns(runs),
            ).filter((run) => {
              const timestamp = Date.parse(run.completedAt ?? run.startedAt)
              return Number.isNaN(timestamp) || timestamp >= cutoff
            }),
          )
        }
      } catch {
        // 历史记录拉取失败不阻塞现有队列与 Runner 显示；下一次刷新会重试
      }

      completed += 1
      setRecentProgress({ completed, total: targets.length })
    }

    setRecentProgress(null)
  }, [])

  const loadAll = useCallback(async (activeClient: GithubClient, announce: boolean) => {
    if (refreshingRef.current) {
      return
    }

    refreshingRef.current = true
    setRefreshing(true)
    const epoch = ++scanEpochRef.current

    try {
      const [repoList, runnerList] = await Promise.all([
        activeClient.listOrgRepos(),
        // 仅把「确认的权限拒绝」当作不可读；限流/网络/5xx 继续抛出交给外层错误处理
        activeClient.listOrgRunners().catch((error: unknown) => {
          if (isRateLimitedError(error)) {
            throw error
          }
          if ((error as { status?: number }).status === 403) {
            return null
          }
          throw error
        }),
      ])

      if (epoch !== scanEpochRef.current) {
        return
      }

      setRepos(repoList)
      if (runnerList === null) {
        setRunners([])
        setRunnersUnavailable(true)
      } else {
        setRunners(runnerList.filter((runner) => !isCopilotRunner(runner)))
        setRunnersUnavailable(false)
      }

      // runner 名集合用于匹配「进行中 job」；列表不可读时为空集合，跳过 busy job 扫描
      const queuedRepoNames = await scanQueued(
        activeClient,
        repoList,
        epoch,
        new Set((runnerList ?? []).filter((runner) => !isCopilotRunner(runner)).map((runner) => runner.name)),
      )
      const runningRecentRepoNames = new Set(
        recentRunsRef.current
          .filter((run) => run.status !== 'completed')
          .map((run) => run.repoName),
      )
      const recentRepoNames = new Set([...queuedRepoNames, ...runningRecentRepoNames])
      await refreshRecentRuns(activeClient, repoList, announce ? undefined : recentRepoNames)

      if (announce && epoch === scanEpochRef.current) {
        setNotice({
          tone: 'success',
          title: '已完成首次扫描。',
          description: '凭据由首页统一管理，本页面复用共享连接。',
        })
      }
    } catch (error) {
      if (epoch === scanEpochRef.current) {
        setNotice({
          tone: 'error',
          title: '加载 Runner 与队列数据失败。',
          description: formatError(error, '请检查令牌权限、组织名称或网络连接。'),
        })
      }
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [refreshRecentRuns, scanQueued])

  // ── 首次加载与自动刷新 ─────────────────────────────────────────────

  // 首次挂载自动加载；用宏任务触发避免 effect 内同步级联 setState
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAll(client, true)
    }, 0)
    return () => clearTimeout(timer)
  }, [client, loadAll])

  useEffect(() => {
    if (autoRefreshSeconds <= 0) {
      return
    }

    const timer = setInterval(() => {
      void loadAll(client, false)
    }, autoRefreshSeconds * 1000)

    return () => clearInterval(timer)
  }, [client, autoRefreshSeconds, loadAll])

  // 本地时钟：每 5 秒更新等待时长显示
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  // 卸载时作废进行中的扫描
  useEffect(() => {
    return () => {
      scanEpochRef.current += 1
    }
  }, [])

  // ── 派生视图数据 ─────────────────────────────────────────────────────

  const columns = classifyRunners(runners)
  const stats = runnerStats(runners)
  const loadPercent = Math.round(stats.loadRatio * 100)
  const loadTier = stats.loadRatio < 0.5 ? 'low' : stats.loadRatio < 0.8 ? 'mid' : 'high'

  const filteredRuns = queuedRuns
  const filteredRecentRuns = filterRecentRunsByStatus(recentRuns, recentSuccessOnly).filter((run) =>
    matchesRecentRunFilter(run, filterQuery),
  )
  const longestWait = longestWaitMs(filteredRuns, now)

  // ── 渲染 ─────────────────────────────────────────────────────────────

  return (
    <main className="app-shell">
      <div className="back-nav">
        <button type="button" className="back-nav-button" onClick={onBack}>
          ← 返回首页
        </button>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Actions Runner 运行看板</span>
          <h1>谁在跑，谁在等，一眼看清。</h1>
          <p>
            监控组织自托管 Runner 的在线与忙碌状态，并汇总全部仓库中排队等待执行的 workflow。
          </p>
          <div className="badge-row">
            <span className="badge">只读监控，无任何写操作</span>
            <span className="badge">默认仅扫描 24 小时内有推送的仓库</span>
            <span className="badge">支持自动刷新</span>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <strong>凭据策略</strong>
            <span>PAT 与组织名仅存内存，关闭页面即销毁。</span>
          </div>
          <div className="meta-card">
            <strong>令牌权限</strong>
            <span>需要 admin:org 与 repo；查看 Runner 还需 manage_runners:org。</span>
          </div>
          <div className="meta-card">
            <strong>数据口径</strong>
            <span>GitHub 托管 Runner 无 API，仅展示自托管 Runner。</span>
          </div>
        </div>
      </section>

      <section className="control-panel">
        <div className="connected-bar">
          <span className="org-label">{org.trim()}</span>
          <span className="stat-badge">{repos.length} 个仓库</span>
          <label className="scan-toggle">
            <input
              type="checkbox"
              checked={recentOnly}
              disabled={refreshing}
              onChange={(event) => {
                const checked = event.target.checked
                recentOnlyRef.current = checked
                setRecentOnly(checked)
                void loadAll(client, false)
              }}
            />
            仅扫描 24 小时内有推送的仓库
          </label>
          <select
            className="auto-refresh-select"
            aria-label="自动刷新周期"
            value={autoRefreshSeconds}
            onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))}
          >
            {AUTO_REFRESH_OPTIONS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                自动刷新：{option.label}
              </option>
            ))}
          </select>
          <div className="connected-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={refreshing}
              onClick={() => void loadAll(client, false)}
            >
              {refreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {notice && (
          <div className={`status-banner ${notice.tone}`} role="status">
            <strong>{notice.title}</strong>
            {notice.description && <span>{notice.description}</span>}
          </div>
        )}
      </section>

      {/* ── Runner 看板 ── */}
          <section className="board-panel runner-board-panel">
            <div className="section-title">
              <h2>🏃 自托管 Runner 池</h2>
              <p>空闲 / 忙碌 / 离线三列视图，负载条展示在线 Runner 的忙碌占比。</p>
            </div>

            {runnersUnavailable && (
              <div className="status-banner warning">
                <strong>Runner 列表不可读</strong>
                <span>
                  当前令牌缺少 manage_runners:org 权限，无法读取组织 Runner 状态；队列监控不受影响。
                </span>
              </div>
            )}

            <div className="runner-overview">
              <div className="runner-stat">
                <span className="runner-stat-icon">🖥️</span>
                <div className="runner-stat-body">
                  <strong>{stats.total}</strong>
                  <span>Runner 总数</span>
                </div>
              </div>
              <div className="runner-stat is-idle">
                <span className="runner-stat-icon">🟢</span>
                <div className="runner-stat-body">
                  <strong>{stats.idle}</strong>
                  <span>空闲</span>
                </div>
              </div>
              <div className="runner-stat is-busy">
                <span className="runner-stat-icon">🔵</span>
                <div className="runner-stat-body">
                  <strong>{stats.busy}</strong>
                  <span>忙碌</span>
                </div>
              </div>
              <div className="runner-stat is-offline">
                <span className="runner-stat-icon">⚫</span>
                <div className="runner-stat-body">
                  <strong>{stats.offline}</strong>
                  <span>离线</span>
                </div>
              </div>
              <div className="load-meter">
                <div className="load-meter-head">
                  <span>在线负载</span>
                  <strong>{loadPercent}%</strong>
                </div>
                <div className="load-bar">
                  <div className={`load-bar-fill is-${loadTier}`} style={{ width: `${loadPercent}%` }} />
                </div>
                <span className="load-meter-caption">
                  {stats.busy} 忙碌 / {stats.online} 在线
                </span>
              </div>
            </div>

            <div className="runner-board">
              {RUNNER_COLUMNS.map((column) => {
                const columnRunners = columns[column.key]
                return (
                  <div key={column.key} className={`runner-column is-${column.key}`}>
                    <div className="runner-column-header">
                      <h3>
                        {column.icon} {column.title}
                      </h3>
                      <span className="runner-column-count">{columnRunners.length}</span>
                    </div>
                    <p className="runner-column-hint">{column.hint}</p>
                    <div className="runner-column-cards">
                      {columnRunners.length === 0 ? (
                        <div className="runner-column-empty">暂无</div>
                      ) : (
                        columnRunners.map((runner) => (
                          <div key={runner.id} className={`runner-card is-${column.key}`}>
                            <span className="runner-status-dot" aria-hidden="true" />
                            <div className="runner-card-info">
                              <span className="runner-card-name">{runner.name}</span>
                              <span className="runner-card-meta">
                                <span className="runner-os">{osIcon(runner.os)}</span>
                                {runner.os}
                              </span>
                              {runner.labels.length > 0 && (
                                <span className="runner-card-labels">
                                  {runner.labels.slice(0, MAX_RUNNER_LABELS).map((label) => (
                                    <span key={label.id} className="runner-label-chip">
                                      {label.name}
                                    </span>
                                  ))}
                                  {runner.labels.length > MAX_RUNNER_LABELS && (
                                    <span className="runner-label-chip is-more">
                                      +{runner.labels.length - MAX_RUNNER_LABELS}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                            {column.key === 'busy' &&
                              (runner.currentJob ? (
                                <>
                                  <span className="runner-busy-badge">RUN</span>
                                  <a
                                    className="runner-busy-link"
                                    href={runner.currentJob.htmlUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="在 GitHub 打开该 workflow 的运行详情"
                                  >
                                    <span className="runner-busy-workflow">
                                      {runner.currentJob.displayTitle || runner.currentJob.workflowName}
                                    </span>
                                    <span className="queue-external">↗</span>
                                  </a>
                                </>
                              ) : (
                                <span className="runner-busy-badge">RUN</span>
                              ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── 排队队列看板 ── */}
          <section className="board-panel queue-panel">
            <div className="section-title">
              <h2>⏳ 排队等待的 workflow</h2>
              <p>按等待时长排序，等待条相对最长等待绘制；点击条目打开 GitHub 上的运行详情。</p>
            </div>

            <div className="toolbar">
              <div className="toolbar-main">
                <div className="queue-summary">
                  <div className="queue-summary-stat is-total">
                    <strong>{filteredRuns.length}</strong>
                    <span>排队中</span>
                  </div>
                  <div className="queue-summary-stat is-longest">
                    <strong>{filteredRuns.length > 0 ? formatWaitDuration(longestWait) : '—'}</strong>
                    <span>最长等待</span>
                  </div>
                  <div className="queue-summary-stat is-cover">
                    <strong>{scanProgress ? `${scanProgress.completed}/${scanProgress.total}` : '—'}</strong>
                    <span>扫描覆盖</span>
                  </div>
                </div>
                {scanProgress && (
                  <div className="scan-progress">
                    <div className="load-bar">
                      <div
                        className="load-bar-fill is-low"
                        style={{
                          width: `${scanProgress.total === 0 ? 100 : (scanProgress.completed / scanProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                    <span>
                      正在扫描队列 {scanProgress.completed}/{scanProgress.total}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {skippedRepos > 0 && (
              <div className="queue-skip-hint">
                ⚠️ {skippedRepos} 个仓库无法读取（未启用 Actions 或令牌缺少 repo 权限），其排队状态未计入。
              </div>
            )}

            {scanFailures > 0 && (
              <div className="queue-skip-hint">
                ⚠️ {scanFailures} 个仓库扫描失败（限流或网络问题），当前结果可能不完整。
              </div>
            )}

            {filteredRuns.length === 0 ? (
              <div className="empty-state queue-empty">
                <span className="queue-empty-icon">🎉</span>
                <p>当前没有排队等待的 workflow。</p>
                <p className="queue-empty-sub">
                  {recentOnly
                    ? '所有已触发的工作流要么已完成，要么正在执行。仅扫描了 24 小时内有推送的仓库，定时/手动触发且仓库久未推送的任务不在扫描范围内。'
                    : '所有已触发的工作流要么已完成，要么正在执行。'}
                </p>
              </div>
            ) : (
              <ol className="queue-list">
                {filteredRuns.map((run, index) => {
                  const waitMs = waitMsOf(run, now)
                  const tier = waitTierOf(waitMs)
                  const ratio = waitRatioOf(run, now, longestWait)
                  return (
                    <li key={run.id} className={`queue-row is-${tier}`}>
                      <span className="queue-rank">#{index + 1}</span>
                      <div className="queue-row-main">
                        <div className="queue-row-title">
                          <a
                            className="queue-repo"
                            href={`https://github.com/${org.trim()}/${run.repoName}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {run.repoName}
                          </a>
                          <span className="queue-workflow">{run.displayTitle || run.name}</span>
                        </div>
                        <div className="queue-row-tags">
                          <span className="repo-tag is-topic">🌿 {run.headBranch}</span>
                          <span className="repo-tag is-topic">{eventLabel(run.event)}</span>
                          {run.actor && <span className="repo-tag is-access user">@{run.actor}</span>}
                          <span className="repo-tag is-public">run #{run.runNumber}</span>
                        </div>
                        <div className="wait-bar-track">
                          <div className={`wait-bar-fill is-${tier}`} style={{ width: `${ratio * 100}%` }} />
                        </div>
                      </div>
                      <a
                        className="queue-wait"
                        href={run.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="在 GitHub 打开运行详情"
                      >
                        <span className={`queue-wait-time is-${tier}`}>{formatWaitDuration(waitMs)}</span>
                        <span className="queue-external">↗</span>
                      </a>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className="board-panel recent-panel">
            <div className="section-title">
              <h2>📊 最近 30 天运行记录</h2>
              <p>按时间倒序展示每个 workflow 的最新运行，使用紧凑矩阵卡片。</p>
            </div>

            <div className="recent-toolbar">
              <div className="search-box toolbar-search">
                <input
                  type="text"
                  className="queue-filter-input"
                  aria-label="过滤最近 30 天运行记录"
                  placeholder="过滤仓库 / workflow / 分支…"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                />
                {filterQuery && (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="清空最近记录过滤"
                    onClick={() => setFilterQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
              <label className="recent-success-toggle">
                <input
                  type="checkbox"
                  checked={recentSuccessOnly}
                  onChange={(event) => setRecentSuccessOnly(event.target.checked)}
                />
                仅显示成功运行
              </label>
              {recentProgress && (
                <span className="recent-loading-status">
                  正在加载 {recentProgress.completed}/{recentProgress.total} 个仓库
                </span>
              )}
            </div>

            {filteredRecentRuns.length === 0 ? (
              <div className="empty-state queue-empty">
                <span className="queue-empty-icon">🧭</span>
                <p>最近 30 天内没有可展示的 action 记录。</p>
              </div>
            ) : (
              <div className="recent-grid">
                {filteredRecentRuns.map((run) => (
                  <a
                    key={`${run.repoName}:${run.workflowName}:${run.id}`}
                    className={`recent-card ${run.status !== 'completed' ? 'is-running' : run.success ? 'is-success' : 'is-failure'}`}
                    href={run.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="在 GitHub 打开该 workflow 的运行详情"
                  >
                    <div className="recent-card-topline">
                      <span className="recent-status-badge">
                        {run.status !== 'completed' ? '运行中' : run.success ? '成功' : '失败'}
                      </span>
                      <span className="recent-time">
                        {new Date(run.completedAt ?? run.startedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <span className="recent-card-repo">{run.repoName}</span>
                    <strong className="recent-card-title">{run.workflowName}</strong>
                    {run.displayTitle && run.displayTitle !== run.workflowName && (
                      <span className="recent-card-display-title">{run.displayTitle}</span>
                    )}
                    <div className="recent-card-meta">
                      <span>#{run.runNumber}</span>
                    </div>
                    <div className="recent-card-footer">
                      <span>{run.headBranch}</span>
                      <span>{eventLabel(run.event)}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
      </main>
    )
}