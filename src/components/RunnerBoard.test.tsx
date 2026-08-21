import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      head_branch: 'main',
      head_sha: 'deadbeef',
      html_url: `https://github.com/acme/${repoName}/actions/runs/9001`,
      created_at: run.created_at ?? '2025-01-01T10:00:00Z',
      actor: { login: 'alice' },
    })),
  }
}

function stubConnectedApi(
  queuedByRepo: Record<string, Array<Record<string, unknown>>> = {},
  recentByRepo: Record<string, Array<Record<string, unknown>>> = {},
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
    if (url.includes('/jobs')) {
      return jsonResponse({ total_count: 0, jobs: [] })
    }
    if (url.includes('/actions/workflows')) {
      return jsonResponse({ total_count: 0, workflows: [] })
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
})