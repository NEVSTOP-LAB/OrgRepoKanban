import { describe, expect, it } from 'vitest'

import {
  buildTeamTreeOptions,
  collectDirectCollaborators,
  flattenTeamTree,
  toPermissionMap,
  type GithubRepo,
  type GithubTeam,
  type RepoPermission,
} from './data'

const teams: GithubTeam[] = [
  { id: 1, slug: 'platform', name: 'Platform', parent: null },
  {
    id: 2,
    slug: 'platform-backend',
    name: 'Platform Backend',
    parent: { id: 1, slug: 'platform' },
  },
  { id: 3, slug: 'frontend', name: 'Frontend', parent: null },
]

const repos: GithubRepo[] = [
  { id: 10, name: 'api', full_name: 'acme/api', html_url: 'https://github.com/acme/api' },
  { id: 11, name: 'portal', full_name: 'acme/portal', html_url: 'https://github.com/acme/portal' },
]

describe('buildTeamTreeOptions', () => {
  it('builds stable parent-child team tree for selector', () => {
    const tree = buildTeamTreeOptions(teams)
    expect(tree).toHaveLength(2)
    expect(tree[0]?.team.slug).toBe('frontend')
    expect(tree[1]?.team.slug).toBe('platform')
    expect(tree[1]?.children[0]?.team.slug).toBe('platform-backend')
  })
})

describe('flattenTeamTree', () => {
  it('returns depth-aware options for hierarchical rendering', () => {
    const flat = flattenTeamTree(buildTeamTreeOptions(teams))
    expect(flat.map((item) => `${item.depth}:${item.team.slug}`)).toEqual([
      '0:frontend',
      '0:platform',
      '1:platform-backend',
    ])
  })
})

describe('collectDirectCollaborators', () => {
  it('keeps only users with at least one direct repo permission', () => {
    const collaboratorsByRepo = {
      api: [
        { login: 'alice', permission: 'push' },
        { login: 'bob', permission: 'pull' },
      ],
      portal: [{ login: 'alice', permission: 'admin' }],
    }

    const users = collectDirectCollaborators(repos, collaboratorsByRepo)
    expect(users.map((item) => item.login)).toEqual(['alice', 'bob'])
    expect(users[0]?.repos['portal']).toBe('admin')
  })
})

describe('toPermissionMap', () => {
  it('fills unlisted repositories with none permission', () => {
    const source: RepoPermission[] = [{ repoName: 'api', permission: 'triage' }]
    const map = toPermissionMap(repos, source)
    expect(map.api).toBe('triage')
    expect(map.portal).toBe('none')
  })
})
