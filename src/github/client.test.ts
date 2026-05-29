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
})
