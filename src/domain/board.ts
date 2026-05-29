import {
  PERMISSION_COLUMNS,
  type PermissionLevel,
} from './permissions'

export interface RepoSummary {
  id: number
  name: string
  fullName: string
}

export type BoardColumns = Record<PermissionLevel, RepoSummary[]>

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
