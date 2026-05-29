import {
  PERMISSION_COLUMNS,
  type PermissionLevel,
} from './permissions'

export interface RepoSummary {
  id: number
  name: string
  fullName: string
  url: string
  isPrivate?: boolean
  isFork?: boolean
}

export type BoardColumns = Record<PermissionLevel, RepoSummary[]>
export type RepoFilterPreset = 'all' | 'public' | 'private' | 'forked'
export type InheritedFilter = 'all' | 'inherited-only' | 'direct-only'

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

function matchesInheritedFilter(
  repoName: string,
  inheritedFilter: InheritedFilter,
  permissionByRepo: Record<string, PermissionLevel>,
  parentPermissionByRepo: Record<string, PermissionLevel> | null,
): boolean {
  if (inheritedFilter === 'all' || !parentPermissionByRepo) {
    return true
  }

  const currentPermission = permissionByRepo[repoName] ?? 'none'
  const parentPermission = parentPermissionByRepo[repoName] ?? 'none'

  // A repo is considered "inherited" if parent has the same or higher permission
  // (meaning child team did not directly grant additional access)
  const isInherited = parentPermission !== 'none' && parentPermission === currentPermission

  if (inheritedFilter === 'inherited-only') {
    return isInherited
  }

  // 'direct-only': show repos NOT inherited from parent
  return !isInherited
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
  inheritedFilter: InheritedFilter = 'all',
  parentPermissionByRepo: Record<string, PermissionLevel> | null = null,
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

    if (!matchesInheritedFilter(repo.name, inheritedFilter, permissionByRepo, parentPermissionByRepo)) {
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
