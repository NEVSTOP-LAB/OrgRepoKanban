import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubClient } from './client'

const fetchMock = vi.fn<typeof fetch>()

describe('GithubClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('verifies admin role in target organization', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ role: 'admin' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    await expect(client.verifyOrgAdmin()).resolves.toBe(true)
  })

  it('loads paginated org repositories', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 1, name: 'repo-a', full_name: 'acme/repo-a' },
            { id: 2, name: 'repo-b', full_name: 'acme/repo-b' },
          ]),
          {
            status: 200,
            headers: {
              link: '<https://api.github.com/orgs/acme/repos?page=2>; rel="next"',
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 3, name: 'repo-c', full_name: 'acme/repo-c' }]),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )

    const client = new GithubClient('token-value', 'acme')
    const repos = await client.listOrgRepos()
    expect(repos.map((repo) => repo.name)).toEqual(['repo-a', 'repo-b', 'repo-c'])
  })

  it('sends correct API mutation for team permission update', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new GithubClient('token-value', 'acme')
    await client.setTeamRepoPermission('platform', 'repo-a', 'maintain')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('/orgs/acme/teams/platform/repos/acme/repo-a')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toContain('maintain')
  })

  it('throws typed error for failed request', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    await expect(client.listTeams()).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
  })

  it('lists org members', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { login: 'alice', id: 1 },
          { login: 'bob', id: 2 },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const client = new GithubClient('token-value', 'acme')
    const members = await client.listOrgMembers()
    expect(members.map((m) => m.login)).toEqual(['alice', 'bob'])
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('/orgs/acme/members')
  })

  it('returns user repo permission preferring role_name over permission', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ permission: 'admin', role_name: 'maintain' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const client = new GithubClient('token-value', 'acme')
    const level = await client.getUserRepoPermission('repo-a', 'alice')
    expect(level).toBe('maintain')
  })

  it('falls back to permission field when role_name is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ permission: 'push' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const client = new GithubClient('token-value', 'acme')
    const level = await client.getUserRepoPermission('repo-a', 'alice')
    expect(level).toBe('push')
  })

  it('lists teams the user is a member of, skipping 404s', async () => {
    // First call: fetch all org teams
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 1, name: 'Team A', slug: 'team-a' },
          { id: 2, name: 'Team B', slug: 'team-b' },
          { id: 3, name: 'Team C', slug: 'team-c' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    // team-a: user is a member (204)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    // team-b: user is not a member (404)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    // team-c: user is a member (200)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ state: 'active' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    const teams = await client.listUserTeams('alice')
    expect(teams).toEqual(expect.arrayContaining(['team-a', 'team-c']))
    expect(teams).not.toContain('team-b')
  })

  it('rethrows non-404 errors from team membership check', async () => {
    // First call: fetch all org teams
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ id: 1, name: 'Team A', slug: 'team-a' }]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    // Membership check returns 403
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    await expect(client.listUserTeams('alice')).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
  })

  it('lists org self-hosted runners with pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 3,
            runners: [
              { id: 11, name: 'linux-1', os: 'linux', status: 'online', busy: false, labels: [] },
            ],
          }),
          {
            status: 200,
            headers: {
              link: '<https://api.github.com/orgs/acme/actions/runners?page=2>; rel="next"',
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 3,
            runners: [
              { id: 12, name: 'mac-1', os: 'macos', status: 'online', busy: true, labels: [] },
              { id: 13, name: 'win-1', os: 'windows', status: 'offline', busy: false, labels: [] },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )

    const client = new GithubClient('token-value', 'acme')
    const runners = await client.listOrgRunners()
    expect(runners.map((runner) => runner.id)).toEqual([11, 12, 13])
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/orgs/acme/actions/runners?per_page=100')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('page=2')
  })

  it('maps queued workflow runs into flat records', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              id: 9001,
              name: 'CI',
              display_title: 'CI / test',
              run_number: 12,
              event: 'push',
              head_branch: 'main',
              head_sha: 'deadbeef',
              html_url: 'https://github.com/acme/repo-a/actions/runs/9001',
              created_at: '2025-01-01T10:00:00Z',
              actor: { login: 'alice' },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const client = new GithubClient('token-value', 'acme')
    const runs = await client.listQueuedWorkflowRuns('repo-a')
    expect(runs).not.toBeNull()
    expect(runs).toHaveLength(1)
    expect(runs![0]).toMatchObject({
      id: 9001,
      repoName: 'repo-a',
      displayTitle: 'CI / test',
      headBranch: 'main',
      actor: 'alice',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/repos/acme/repo-a/actions/runs?status=queued')
  })

  it('skips repos where queued runs listing is unavailable', async () => {
    for (const status of [403, 404, 409]) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'unavailable' }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const client = new GithubClient('token-value', 'acme')
      await expect(client.listQueuedWorkflowRuns('repo-a')).resolves.toBe(null)
    }
  })

  it('rethrows unexpected errors from queued runs listing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    await expect(client.listQueuedWorkflowRuns('repo-a')).rejects.toMatchObject({
      status: 429,
    })
  })

  it('maps in-progress jobs to busy runners and filters by runner name', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
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
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 2,
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
              {
                id: 7002,
                run_id: 8001,
                name: 'lint',
                status: 'in_progress',
                started_at: '2025-01-01T10:00:06Z',
                html_url: 'https://github.com/acme/repo-a/actions/runs/8001/job/7002',
                runner_name: 'mac-1',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )

    const client = new GithubClient('token-value', 'acme')
    const jobs = await client.listBusyRunnerJobs('repo-a', new Set(['win-1']))
    expect(jobs).not.toBeNull()
    expect(jobs).toHaveLength(1)
    expect(jobs![0]).toMatchObject({
      runnerName: 'win-1',
      repoName: 'repo-a',
      workflowName: 'CI',
      displayTitle: 'CI / deploy',
      jobName: 'deploy',
      runNumber: 99,
      htmlUrl: 'https://github.com/acme/repo-a/actions/runs/8001',
      startedAt: '2025-01-01T10:00:05Z',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/repos/acme/repo-a/actions/runs?status=in_progress')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/repos/acme/repo-a/actions/runs/8001/jobs')
  })

  it('skips API calls and returns empty when runner name set is empty', async () => {
    const client = new GithubClient('token-value', 'acme')
    const jobs = await client.listBusyRunnerJobs('repo-a', new Set())
    expect(jobs).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for unreadable repos in busy runner jobs', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'unavailable' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new GithubClient('token-value', 'acme')
    await expect(client.listBusyRunnerJobs('repo-a', new Set(['win-1']))).resolves.toBe(null)
  })

  it('rethrows 403 responses that carry rate-limit headers', async () => {
    const cases: Array<Record<string, string>> = [
      { 'x-ratelimit-remaining': '0' },
      { 'retry-after': '30' },
    ]

    for (const extraHeaders of cases) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 403,
          headers: { 'content-type': 'application/json', ...extraHeaders },
        }),
      )

      const client = new GithubClient('token-value', 'acme')
      await expect(client.listQueuedWorkflowRuns('repo-a')).rejects.toMatchObject({
        status: 403,
      })
    }
  })
})
