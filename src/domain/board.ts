import {
  PERMISSION_COLUMNS,
  type PermissionLevel,
} from './permissions'

export interface RepoSummary {
  id: number
  name: string
  fullName: string
  isPrivate?: boolean
  isFork?: boolean
}

export type BoardColumns = Record<PermissionLevel, RepoSummary[]>
export type RepoFilterPreset = 'all' | 'public' | 'private' | 'forked'

function matchesRepoPreset(repo: RepoSummary, preset: RepoFilterPreset): boolean {
  if (preset === 'all') {
    return true
  }

  if (preset === 'public') {
    return !repo.isPrivate
  }

  if (preset === 'private') {
    return Boolean(repo.isPrivate)
  }

  return Boolean(repo.isFork)
}

export function searchRepoByName(name: string, query: string): boolean {
  const normalizedName = name.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  if (normalizedName.includes(normalizedQuery)) {
    return true
  }

  let pointer = 0
  for (const character of normalizedName) {
    if (character === normalizedQuery[pointer]) {
      pointer += 1
      if (pointer === normalizedQuery.length) {
        return true
      }
    }
  }

  return false
}

export function buildBoardColumns(
  repos: RepoSummary[],
  permissionByRepo: Record<string, PermissionLevel>,
  query: string,
  preset: RepoFilterPreset,
): BoardColumns {
  const columns: BoardColumns = {
    none: [],
    pull: [],
    triage: [],
    push: [],
    maintain: [],
    admin: [],
  }

  for (const repo of repos) {
    if (!matchesRepoPreset(repo, preset)) {
      continue
    }

    if (!searchRepoByName(repo.name, query)) {
      continue
    }

    const column = permissionByRepo[repo.name] ?? 'none'
    if (PERMISSION_COLUMNS.includes(column)) {
      columns[column].push(repo)
    } else {
      columns.none.push(repo)
    }
  }

  return columns
}
