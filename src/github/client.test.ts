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
})
