import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubClient } from '../github/client'
import { RunnerBoard } from './RunnerBoard'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const REPOS = [
  {
    id: 1,
    name: 'repo-a',
    full_name: 'acme/repo-a',
    html_url: 'https://github.com/acme/repo-a',
    pushed_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'repo-b',
    full_name: 'acme/repo-b',
    html_url: 'https://github.com/acme/repo-b',
    pushed_at: new Date().toISOString(),
  },
]

const RUNNERS = {
  total_count: 2,
  runners: [
    {
      id: 11,
      name: 'linux-1',
      os: 'linux',
      status: 'online',
      busy: false,
      labels: [{ id: 1, name: 'self-hosted' }, { id: 2, name: 'docker' }],
    },
    {
      id: 12,
      name: 'win-1',
      os: 'windows',
      status: 'online',
      busy: true,
      labels: [],
    },
  ],
}

function queuedRunResponse(repoName: string, runs: Array<Record<string, unknown>>) {
  return {
    total_count: runs.length,
    workflow_runs: runs.map((run) => ({
      id: run.id ?? 9001,
      name: run.name ?? 'CI',
      display_title: run.display_title ?? 'CI / test',
      run_number: 12,
      event: 'push',
      head_branch: run.head_branch ?? 'main',
      head_sha: 'deadbeef',
      html_url: `https://github.com/acme/${repoName}/actions/runs/9001`,
      created_at: run.created_at ?? '2025-01-01T10:00:00Z',
      actor: { login: 'alice' },
    })),
  }
}

const RECENT_RUN_STARTED_AT = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
const RECENT_RUN_UPDATED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString()

function stubConnectedApi(
  queuedByRepo: Record<string, Array<Record<string, unknown>>> = {},
  recentByRepo: Record<string, Array<Record<string, unknown>>> = {},
  missingBranches: Array<{ repo: string; branch: string }> = [],
) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/actions/runners')) {
      return jsonResponse(RUNNERS)
    }
    if (url.includes('/orgs/acme/repos')) {
      return jsonResponse(REPOS)
    }
    if (url.includes('/actions/runs?status=in_progress')) {
      return jsonResponse({ total_count: 0, workflow_runs: [] })
    }
    if (url.includes('/branches/')) {
      // 分支存在性检查：默认 200（分支存在）；命中 missingBranches 的返回 404
      const repoName = REPOS.find((repo) => url.includes(`/repos/acme/${repo.name}/branches/`))?.name
      const branch = decodeURIComponent(url.split('/branches/')[1] ?? '')
      const missing = missingBranches.some(
        (item) => item.repo === repoName && item.branch === branch,
      )
      if (missing) {
        return new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return jsonResponse({ name: 'main', commit: {} })
    }
    if (url.includes('/jobs')) {
      return jsonResponse({ total_count: 0, jobs: [] })
    }
    if (url.includes('/actions/workflows')) {
      return jsonResponse({ total_count: 1, workflows: [{ id: 101 }] })
    }
    if (url.includes('/actions/runs?per_page=100')) {
      const repoName = REPOS.find((repo) => url.includes(`/repos/acme/${repo.name}/`))?.name
      return jsonResponse({
        total_count: recentByRepo[repoName ?? 'repo-a']?.length ?? 0,
        workflow_runs: recentByRepo[repoName ?? 'repo-a'] ?? [],
      })
    }
    if (url.includes('/actions/runs?status=queued')) {
      const repoName = REPOS.find((repo) => url.includes(`/repos/acme/${repo.name}/`))?.name
      return jsonResponse(queuedRunResponse(repoName ?? 'repo-a', queuedByRepo[repoName ?? 'repo-a'] ?? []))
    }
    throw new Error(`unexpected request: ${url}`)
  })
}

function renderBoard() {
  return render(<RunnerBoard client={new GithubClient('token-value', 'acme')} org="acme" onBack={() => {}} />)
}

describe('RunnerBoard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads runners into three columns and lists queued runs', async () => {
    stubConnectedApi({
      'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test' }],
    })

    renderBoard()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    expect(screen.getByText('win-1')).toBeInTheDocument()
    expect(screen.getByText('🟢 空闲')).toBeInTheDocument()
    expect(screen.getByText('🔵 忙碌')).toBeInTheDocument()
    expect(screen.getByText('⚫ 离线')).toBeInTheDocument()
    expect(screen.getByText('RUN')).toBeInTheDocument()
    expect(screen.getByText('acme')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('repo-a')).toBeInTheDocument())
    expect(screen.getByText('CI / test')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('shows empty queue state when nothing is queued', async () => {
    stubConnectedApi({})

    renderBoard()

    await waitFor(() =>
      expect(screen.getByText('当前没有排队等待的 workflow。')).toBeInTheDocument(),
    )
  })

  it('hides queued runs whose branch was merged or deleted', async () => {
    stubConnectedApi(
      {
        'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test', head_branch: 'feature-x' }],
      },
      {},
      [{ repo: 'repo-a', branch: 'feature-x' }],
    )

    renderBoard()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    // 分支已删除的 run 不显示，并出现隐藏提示条
    expect(screen.queryByText('CI / test')).not.toBeInTheDocument()
    expect(
      screen.getByText(/已隐藏 1 个排队中的 workflow（对应分支已被合并或删除）/),
    ).toBeInTheDocument()
  })

  it('keeps queued runs whose branch still exists', async () => {
    stubConnectedApi({
      'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test' }],
    })

    renderBoard()

    await waitFor(() => expect(screen.getByText('CI / test')).toBeInTheDocument())
    expect(screen.queryByText(/已隐藏/)).not.toBeInTheDocument()
  })

  it('places the filter control in the recent-runs section', async () => {
    stubConnectedApi()
    renderBoard()
    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    expect(screen.getByLabelText('过滤最近 30 天运行记录')).toBeInTheDocument()
    expect(screen.queryByLabelText('过滤排队 workflow')).not.toBeInTheDocument()
  })
  it('reports scan failures separately from unreadable repos', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/actions/runners')) {
        return jsonResponse(RUNNERS)
      }
      if (url.includes('/orgs/acme/repos')) {
        return jsonResponse(REPOS)
      }
      if (url.includes('/repos/acme/repo-a/actions/runs')) {
        return new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/repos/acme/repo-b/actions/runs')) {
        return jsonResponse(queuedRunResponse('repo-b', []))
      }
      throw new Error(`unexpected request: ${url}`)
    })

    renderBoard()

    await waitFor(() =>
      expect(screen.getByText(/1 个仓库扫描失败（限流或网络问题）/)).toBeInTheDocument(),
    )
  })

  it('shows current workflow link on busy runners', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/actions/runners')) {
        return jsonResponse(RUNNERS)
      }
      if (url.includes('/orgs/acme/repos')) {
        return jsonResponse(REPOS)
      }
      if (url.includes('/actions/runs?status=in_progress')) {
        return jsonResponse({
          total_count: 1,
          workflow_runs: [
            {
              id: 8001,
              name: 'CI',
              display_title: 'CI / deploy',
              run_number: 99,
              event: 'push',
              head_branch: 'main',
              head_sha: 'deadbeef',
              html_url: 'https://github.com/acme/repo-a/actions/runs/8001',
              created_at: '2025-01-01T10:00:00Z',
              actor: { login: 'alice' },
            },
          ],
        })
      }
      if (url.includes('/actions/runs/8001/jobs')) {
        return jsonResponse({
          total_count: 1,
          jobs: [
            {
              id: 7001,
              run_id: 8001,
              name: 'deploy',
              status: 'in_progress',
              started_at: '2025-01-01T10:00:05Z',
              html_url: 'https://github.com/acme/repo-a/actions/runs/8001/job/7001',
              runner_name: 'win-1',
            },
          ],
        })
      }
      if (url.includes('/actions/runs?status=queued')) {
        return jsonResponse(queuedRunResponse('repo-a', []))
      }
      throw new Error('unexpected request: ' + url)
    })

    renderBoard()

    await waitFor(() => expect(screen.getByText('win-1')).toBeInTheDocument())
    const link = await screen.findByRole('link', { name: /CI \/ deploy/ })
    expect(link).toHaveAttribute('href', 'https://github.com/acme/repo-a/actions/runs/8001')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('filters Copilot review and code agent runners from the board', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/actions/runners')) {
        return jsonResponse({
          total_count: 4,
          runners: [
            ...RUNNERS.runners,
            {
              id: 13,
              name: 'copilot-review-runner',
              os: 'linux',
              status: 'online',
              busy: true,
              labels: [],
            },
            {
              id: 14,
              name: 'managed-runner',
              os: 'linux',
              status: 'online',
              busy: false,
              labels: [{ id: 3, name: 'Code Agent' }],
            },
          ],
        })
      }
      if (url.includes('/orgs/acme/repos')) {
        return jsonResponse(REPOS)
      }
      if (url.includes('/actions/runs?status=queued')) {
        return jsonResponse(queuedRunResponse('repo-a', []))
      }
      if (url.includes('/actions/runs?status=in_progress')) {
        return jsonResponse({ total_count: 0, workflow_runs: [] })
      }
      if (url.includes('/jobs')) {
        return jsonResponse({ total_count: 0, jobs: [] })
      }
      if (url.includes('/actions/workflows')) {
        return jsonResponse({ total_count: 0, workflows: [] })
      }
      throw new Error(`unexpected request: ${url}`)
    })

    renderBoard()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    expect(screen.queryByText('copilot-review-runner')).not.toBeInTheDocument()
    expect(screen.queryByText('managed-runner')).not.toBeInTheDocument()
    expect(screen.getByText('Runner 总数')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows repository and workflow names on recent run cards', async () => {
    stubConnectedApi({}, {
      'repo-a': [{
        id: 9101,
        workflow_id: 101,
        name: 'Deploy',
        display_title: 'Deploy production',
        run_number: 8,
        event: 'push',
        head_branch: 'main',
        html_url: 'https://github.com/acme/repo-a/actions/runs/9101',
        run_started_at: RECENT_RUN_STARTED_AT,
        created_at: RECENT_RUN_STARTED_AT,
        updated_at: RECENT_RUN_UPDATED_AT,
        status: 'completed',
        conclusion: 'success',
        actor: { login: 'alice' },
      }],
    })

    renderBoard()

    expect(await screen.findByText('repo-a')).toBeInTheDocument()
    expect(screen.getByText('Deploy')).toBeInTheDocument()
    expect(screen.getByText('Deploy production')).toBeInTheDocument()
  })

  it('shows running workflow status instead of failure', async () => {
    stubConnectedApi({}, {
      'repo-a': [{
        id: 9102,
        workflow_id: 101,
        name: 'Review',
        display_title: 'Review pull request',
        run_number: 9,
        event: 'pull_request',
        head_branch: 'main',
        html_url: 'https://github.com/acme/repo-a/actions/runs/9102',
        run_started_at: RECENT_RUN_STARTED_AT,
        created_at: RECENT_RUN_STARTED_AT,
        status: 'in_progress',
        conclusion: null,
        actor: { login: 'alice' },
      }],
    })

    renderBoard()

    const card = (await screen.findByText('Review pull request')).closest<HTMLElement>('.recent-card')
    expect(card).not.toBeNull()
    expect(within(card!).getByText('运行中')).toBeInTheDocument()
    expect(within(card!).queryByText('失败')).not.toBeInTheDocument()
  })

  it('状态筛选下拉：默认展示全部，可按失败/取消单独筛选', async () => {
    stubConnectedApi({}, {
      'repo-a': [
        {
          id: 9201,
          workflow_id: 101,
          name: 'Deploy',
          display_title: 'Deploy production',
          run_number: 21,
          event: 'push',
          head_branch: 'main',
          html_url: 'https://github.com/acme/repo-a/actions/runs/9201',
          run_started_at: RECENT_RUN_STARTED_AT,
          created_at: RECENT_RUN_STARTED_AT,
          updated_at: RECENT_RUN_UPDATED_AT,
          status: 'completed',
          conclusion: 'success',
          actor: { login: 'alice' },
        },
        {
          id: 9202,
          workflow_id: 101,
          name: 'Nightly',
          display_title: 'Nightly build',
          run_number: 22,
          event: 'schedule',
          head_branch: 'main',
          html_url: 'https://github.com/acme/repo-a/actions/runs/9202',
          run_started_at: RECENT_RUN_STARTED_AT,
          created_at: RECENT_RUN_STARTED_AT,
          updated_at: RECENT_RUN_UPDATED_AT,
          status: 'completed',
          conclusion: 'failure',
          actor: { login: 'alice' },
        },
        {
          id: 9203,
          workflow_id: 101,
          name: 'Release',
          display_title: 'Release cut',
          run_number: 23,
          event: 'workflow_dispatch',
          head_branch: 'main',
          html_url: 'https://github.com/acme/repo-a/actions/runs/9203',
          run_started_at: RECENT_RUN_STARTED_AT,
          created_at: RECENT_RUN_STARTED_AT,
          updated_at: RECENT_RUN_UPDATED_AT,
          status: 'completed',
          conclusion: 'cancelled',
          actor: { login: 'alice' },
        },
      ],
    })

    renderBoard()

    const select = await screen.findByLabelText('筛选最近运行状态')
    // 默认「全部状态」：成功/失败/取消三种记录都展示（用各自唯一的展示标题断言，避免与下拉选项冲突）
    expect(await screen.findByText('Deploy production')).toBeInTheDocument()
    expect(screen.getByText('Nightly build')).toBeInTheDocument()
    expect(screen.getByText('Release cut')).toBeInTheDocument()

    // 筛选「失败」：只保留失败记录
    fireEvent.change(select, { target: { value: 'failure' } })
    await waitFor(() => expect(screen.queryByText('Deploy production')).not.toBeInTheDocument())
    expect(screen.getByText('Nightly build')).toBeInTheDocument()
    expect(screen.queryByText('Release cut')).not.toBeInTheDocument()

    // 筛选「取消」：取消与失败互不影响
    fireEvent.change(select, { target: { value: 'cancelled' } })
    await waitFor(() => expect(screen.queryByText('Nightly build')).not.toBeInTheDocument())
    expect(screen.getByText('Release cut')).toBeInTheDocument()
  })

  it('取消的运行显示「取消」并使用灰色样式，而非失败', async () => {
    stubConnectedApi({}, {
      'repo-a': [{
        id: 9300,
        workflow_id: 101,
        name: 'Release',
        display_title: 'Release cut',
        run_number: 30,
        event: 'workflow_dispatch',
        head_branch: 'main',
        html_url: 'https://github.com/acme/repo-a/actions/runs/9300',
        run_started_at: RECENT_RUN_STARTED_AT,
        created_at: RECENT_RUN_STARTED_AT,
        updated_at: RECENT_RUN_UPDATED_AT,
        status: 'completed',
        conclusion: 'cancelled',
        actor: { login: 'alice' },
      }],
    })

    renderBoard()

    const card = (await screen.findByText('Release cut')).closest<HTMLElement>('.recent-card')
    expect(card).not.toBeNull()
    expect(card).toHaveClass('is-cancelled')
    expect(card).not.toHaveClass('is-failure')
    expect(within(card!).getByText('取消')).toBeInTheDocument()
  })

  it('隐藏分支已删除的最近运行记录（30 天运行记录亦遵循分支存在性规则）', async () => {
    stubConnectedApi(
      {},
      {
        'repo-a': [{
          id: 9301,
          workflow_id: 101,
          name: 'CI',
          display_title: 'CI / feature-x',
          run_number: 7,
          event: 'push',
          head_branch: 'feature-x',
          html_url: 'https://github.com/acme/repo-a/actions/runs/9301',
          run_started_at: RECENT_RUN_STARTED_AT,
          created_at: RECENT_RUN_STARTED_AT,
          updated_at: RECENT_RUN_UPDATED_AT,
          status: 'completed',
          conclusion: 'success',
          actor: { login: 'alice' },
        }],
      },
      [{ repo: 'repo-a', branch: 'feature-x' }],
    )

    renderBoard()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    // 分支已删除的运行记录被隐藏，不展示其 workflow 卡片
    expect(screen.queryByText('CI / feature-x')).not.toBeInTheDocument()
    expect(screen.getByText(/最近 30 天内没有可展示的 action 记录/)).toBeInTheDocument()
  })

  it('updates running workflow status after it completes on next refresh', async () => {
    let recentRunsCallCount = 0
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/actions/runners')) {
        return jsonResponse(RUNNERS)
      }
      if (url.includes('/orgs/acme/repos')) {
        return jsonResponse(REPOS)
      }
      if (url.includes('/actions/runs?status=queued')) {
        return jsonResponse(queuedRunResponse('repo-a', []))
      }
      if (url.includes('/actions/runs?status=in_progress')) {
        return jsonResponse({ total_count: 0, workflow_runs: [] })
      }
      if (url.includes('/jobs')) {
        return jsonResponse({ total_count: 0, jobs: [] })
      }
      if (url.includes('/actions/workflows')) {
        return jsonResponse({ total_count: 1, workflows: [{ id: 101 }] })
      }
      if (url.includes('/repos/acme/repo-a/actions/runs?per_page=100')) {
        recentRunsCallCount += 1
        return jsonResponse({
          total_count: 1,
          workflow_runs: [
            {
              id: 9103,
              workflow_id: 101,
              name: 'Deploy',
              display_title: 'Deploy production',
              run_number: 10,
              event: 'push',
              head_branch: 'main',
              html_url: 'https://github.com/acme/repo-a/actions/runs/9103',
              run_started_at: RECENT_RUN_STARTED_AT,
              created_at: RECENT_RUN_STARTED_AT,
              updated_at: RECENT_RUN_UPDATED_AT,
              status: recentRunsCallCount === 1 ? 'in_progress' : 'completed',
              conclusion: recentRunsCallCount === 1 ? null : 'success',
              actor: { login: 'alice' },
            },
          ],
        })
      }
      if (url.includes('/repos/acme/repo-b/actions/runs?per_page=100')) {
        return jsonResponse({ total_count: 0, workflow_runs: [] })
      }
      throw new Error(`unexpected request: ${url}`)
    })

    renderBoard()

    const cardBefore = (await screen.findByText('Deploy production')).closest<HTMLElement>('.recent-card')
    expect(within(cardBefore!).getByText('运行中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => {
      const card = screen.getByText('Deploy production').closest<HTMLElement>('.recent-card')
      expect(within(card!).getByText('成功')).toBeInTheDocument()
    })
    const card = screen.getByText('Deploy production').closest<HTMLElement>('.recent-card')
    expect(within(card!).queryByText('运行中')).not.toBeInTheDocument()
    expect(recentRunsCallCount).toBeGreaterThanOrEqual(2)
  })

  it('defaults auto refresh to 3 minutes with 30s/1min/3min/5min options', async () => {
    stubConnectedApi({})

    renderBoard()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    const select = screen.getByLabelText('自动刷新周期') as HTMLSelectElement
    expect(select.value).toBe('180')
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      '30',
      '60',
      '180',
      '300',
    ])
  })

  it('队列支持按仓库名 / 触发时间本地重排，无需重新连接', async () => {
    stubConnectedApi({
      'repo-a': [
        { id: 9001, name: 'CI', display_title: 'CI / a-new', created_at: '2025-01-01T10:00:00Z', head_branch: 'main' },
        { id: 9002, name: 'CI', display_title: 'CI / a-old', created_at: '2025-01-01T09:30:00Z', head_branch: 'main' },
      ],
      'repo-b': [
        { id: 9003, name: 'CI', display_title: 'CI / b-old', created_at: '2025-01-01T09:00:00Z', head_branch: 'feature-x' },
      ],
    })

    const { container } = renderBoard()

    await waitFor(() => expect(screen.getByText('CI / a-new')).toBeInTheDocument())

    const queueTitles = () =>
      Array.from(container.querySelectorAll('.queue-row')).map((row) => row.textContent ?? '')

    // 默认「等待时长（最久优先）」：repo-b（09:00 最早触发）在最前
    expect(queueTitles()[0]).toContain('CI / b-old')
    expect(queueTitles()[1]).toContain('CI / a-old')
    expect(queueTitles()[2]).toContain('CI / a-new')

    // 切换排序不应触发任何网络请求（纯本地重排）
    const fetchCount = () => fetchMock.mock.calls.length
    const countBefore = fetchCount()

    // 切换到「仓库名」：repo-a 的两条排到 repo-b 前，且同仓库保持原相对顺序（稳定）
    fireEvent.change(screen.getByLabelText('队列排序方式'), { target: { value: 'repo' } })
    expect(queueTitles()[0]).toContain('CI / a-old')
    expect(queueTitles()[1]).toContain('CI / a-new')
    expect(queueTitles()[2]).toContain('CI / b-old')
    expect(fetchCount()).toBe(countBefore)

    // 切换到「触发时间（最新优先）」：最新触发的排最前
    fireEvent.change(screen.getByLabelText('队列排序方式'), { target: { value: 'created' } })
    expect(queueTitles()[0]).toContain('CI / a-new')
    expect(queueTitles()[1]).toContain('CI / a-old')
    expect(queueTitles()[2]).toContain('CI / b-old')
    expect(fetchCount()).toBe(countBefore)
  })
})