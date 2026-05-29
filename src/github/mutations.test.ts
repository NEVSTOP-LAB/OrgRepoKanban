import { describe, expect, it, vi } from 'vitest'

import { executePermissionBatch } from './mutations'

describe('executePermissionBatch', () => {
  it('updates team permissions for every selected repository', async () => {
    const client = {
      setTeamRepoPermission: vi.fn().mockResolvedValue(undefined),
      removeTeamRepoPermission: vi.fn(),
      setUserRepoPermission: vi.fn(),
      removeUserRepoPermission: vi.fn(),
    }

    const results = await executePermissionBatch(client, {
      subject: { kind: 'team', key: 'platform' },
      repoNames: ['repo-a', 'repo-b'],
      target: 'push',
    })

    expect(client.setTeamRepoPermission).toHaveBeenCalledTimes(2)
    expect(results.every((item) => item.success)).toBe(true)
  })

  it('removes direct collaborator permission when target is none', async () => {
    const client = {
      setTeamRepoPermission: vi.fn(),
      removeTeamRepoPermission: vi.fn(),
      setUserRepoPermission: vi.fn(),
      removeUserRepoPermission: vi.fn().mockResolvedValue(undefined),
    }

    const results = await executePermissionBatch(client, {
      subject: { kind: 'user', key: 'alice' },
      repoNames: ['repo-a'],
      target: 'none',
    })

    expect(client.removeUserRepoPermission).toHaveBeenCalledWith('repo-a', 'alice')
    expect(results).toEqual([{ repo: 'repo-a', success: true }])
  })

  it('captures partial failures without aborting the whole batch', async () => {
    const client = {
      setTeamRepoPermission: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Forbidden')),
      removeTeamRepoPermission: vi.fn(),
      setUserRepoPermission: vi.fn(),
      removeUserRepoPermission: vi.fn(),
    }

    const results = await executePermissionBatch(client, {
      subject: { kind: 'team', key: 'platform' },
      repoNames: ['repo-a', 'repo-b'],
      target: 'maintain',
    })

    expect(results).toEqual([
      { repo: 'repo-a', success: true },
      { repo: 'repo-b', success: false, error: 'Forbidden' },
    ])
  })
})
