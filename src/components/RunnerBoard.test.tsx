import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    if (url.includes('/user/memberships/orgs/')) {
      return jsonResponse({ role: 'admin' })
    }
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

async function connect() {
  render(<RunnerBoard onBack={() => {}} />)
  fireEvent.change(screen.getByLabelText('个人访问令牌（PAT）'), {
    target: { value: 'token-value' },
  })
  fireEvent.change(screen.getByLabelText('组织名称'), {
    target: { value: 'acme' },
  })
  fireEvent.click(screen.getByRole('button', { name: '连接组织' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '连接组织' })).not.toBeInTheDocument())
}

describe('RunnerBoard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows connection form and back button before connecting', () => {
    render(<RunnerBoard onBack={() => {}} />)
    expect(screen.getByRole('button', { name: '← 返回首页' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '连接组织' })).toBeInTheDocument()
    expect(screen.getByLabelText('个人访问令牌（PAT）')).toBeInTheDocument()
    expect(screen.getByLabelText('组织名称')).toBeInTheDocument()
  })

  it('warns when the token is not an org admin', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ role: 'member' }))

    render(<RunnerBoard onBack={() => {}} />)
    fireEvent.change(screen.getByLabelText('个人访问令牌（PAT）'), {
      target: { value: 'token-value' },
    })
    fireEvent.change(screen.getByLabelText('组织名称'), {
      target: { value: 'acme' },
    })
    fireEvent.click(screen.getByRole('button', { name: '连接组织' }))

    await waitFor(() =>
      expect(screen.getByText('当前令牌不是该组织管理员，无法查看 Runner 与队列。')).toBeInTheDocument(),
    )
  })

  it('loads runners into three columns and lists queued runs', async () => {
    stubConnectedApi({
      'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test' }],
    })

    await connect()

    await waitFor(() => expect(screen.getByText('linux-1')).toBeInTheDocument())
    expect(screen.getByText('win-1')).toBeInTheDocument()
    expect(screen.getByText('🟢 空闲')).toBeInTheDocument()
    expect(screen.getByText('🔵 忙碌')).toBeInTheDocument()
    expect(screen.getByText('⚫ 离线')).toBeInTheDocument()
    expect(screen.getByText('RUN')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('repo-a')).toBeInTheDocument())
    expect(screen.getByText('CI / test')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('shows empty queue state when nothing is queued', async () => {
    stubConnectedApi({})

    await connect()

    await waitFor(() =>
      expect(screen.getByText('当前没有排队等待的 workflow。')).toBeInTheDocument(),
    )
  })

  it('filters queued runs by keyword', async () => {
    stubConnectedApi({
      'repo-a': [{ id: 9001, name: 'CI', display_title: 'CI / test' }],
      'repo-b': [{ id: 9002, name: 'Deploy', display_title: 'Deploy / prod' }],
    })

    await connect()
    await waitFor(() => expect(screen.getByText('CI / test')).toBeInTheDocument())
    expect(screen.getByText('Deploy / prod')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('过滤仓库 / workflow / 分支…'), {
      target: { value: 'deploy' },
    })

    await waitFor(() => expect(screen.queryByText('CI / test')).not.toBeInTheDocument())
    expect(screen.getByText('Deploy / prod')).toBeInTheDocument()
  })
})