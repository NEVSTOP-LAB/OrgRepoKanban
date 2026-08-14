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

function stubConnectedApi(queuedByRepo: Record<string, Array<Record<string, unknown>>> = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/actions/runners')) {
      return jsonResponse(RUNNERS)
    }
    if (url.includes('/orgs/acme/repos')) {
      return jsonResponse(REPOS)
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

  it('filters queued runs by keyword', async () => {
    stubConnectedApi({
      'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test' }],
      'repo-b': [{ id: 9002, name: 'Deploy', display_title: 'Deploy / prod' }],
    })

    renderBoard()
    await waitFor(() => expect(screen.getByText('CI / test')).toBeInTheDocument())
    expect(screen.getByText('Deploy / prod')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('过滤仓库 / workflow / 分支…'), {
      target: { value: 'deploy' },
    })

    await waitFor(() => expect(screen.queryByText('CI / test')).not.toBeInTheDocument())
    expect(screen.getByText('Deploy / prod')).toBeInTheDocument()
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
})