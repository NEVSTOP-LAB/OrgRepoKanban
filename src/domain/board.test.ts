import { describe, expect, it } from 'vitest'

import type { PermissionLevel } from './permissions'
import {
  buildBoardColumns,
  type RepoFilterPreset,
  type RepoSummary,
  searchRepoByName,
} from './board'

const repos: RepoSummary[] = [
  {
    id: 1,
    name: 'backend-gateway',
    fullName: 'acme/backend-gateway',
    url: 'https://github.com/acme/backend-gateway',
    isPrivate: false,
    isFork: false,
  },
  {
    id: 2,
    name: 'client-portal',
    fullName: 'acme/client-portal',
    url: 'https://github.com/acme/client-portal',
    isPrivate: true,
    isFork: false,
  },
  {
    id: 3,
    name: 'infra-ops',
    fullName: 'acme/infra-ops',
    url: 'https://github.com/acme/infra-ops',
    isPrivate: true,
    isFork: true,
  },
]

const permissionByRepo: Record<string, PermissionLevel> = {
  'backend-gateway': 'push',
  'client-portal': 'admin',
  'infra-ops': 'none',
}

describe('buildBoardColumns', () => {
  it('places each repository in exactly one highest permission column', () => {
    const board = buildBoardColumns(repos, permissionByRepo, '', 'all')

    expect(board.push.map((repo) => repo.name)).toEqual(['backend-gateway'])
    expect(board.admin.map((repo) => repo.name)).toEqual(['client-portal'])
    expect(board.none.map((repo) => repo.name)).toEqual(['infra-ops'])
    expect(board.pull).toHaveLength(0)
    expect(board.triage).toHaveLength(0)
    expect(board.maintain).toHaveLength(0)
  })

  it('applies case-insensitive contains filter', () => {
    const board = buildBoardColumns(repos, permissionByRepo, 'PORT', 'all')
    expect(board.admin.map((repo) => repo.name)).toEqual(['client-portal'])
    expect(board.push).toHaveLength(0)
    expect(board.none).toHaveLength(0)
  })

  it.each<[RepoFilterPreset, string[]]>([
    ['public', ['backend-gateway']],
    ['private', ['client-portal', 'infra-ops']],
    ['forked', ['infra-ops']],
  ])('supports preset filter %s', (preset, expectedNames) => {
    const board = buildBoardColumns(repos, permissionByRepo, '', preset)
    const names = Object.values(board)
      .flat()
      .map((repo) => repo.name)
      .sort()

    expect(names).toEqual(expectedNames.sort())
  })
})

describe('searchRepoByName', () => {
  it('supports fuzzy subsequence matching', () => {
    expect(searchRepoByName('backend-gateway', 'bdgt')).toBe(true)
    expect(searchRepoByName('backend-gateway', 'bxx')).toBe(false)
  })
})
