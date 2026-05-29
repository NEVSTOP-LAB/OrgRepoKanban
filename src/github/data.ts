import {
  comparePermission,
  normalizePermission,
  type PermissionLevel,
} from '../domain/permissions'

export interface GithubRepo {
  id: number
  name: string
  full_name: string
  private?: boolean
  fork?: boolean
}

export interface GithubTeamParent {
  id: number
  slug: string
}

export interface GithubTeam {
  id: number
  slug: string
  name: string
  parent: GithubTeamParent | null
}

export interface GithubCollaborator {
  login: string
  permission: string
}

export interface RepoPermission {
  repoName: string
  permission: PermissionLevel
}

export interface TeamNode {
  team: GithubTeam
  children: TeamNode[]
}

export interface TeamFlatOption {
  team: GithubTeam
  depth: number
}

export interface DirectCollaboratorSummary {
  login: string
  repos: Record<string, PermissionLevel>
}

export function buildTeamTreeOptions(teams: GithubTeam[]): TeamNode[] {
  const nodeById = new Map<number, TeamNode>()
  for (const team of teams) {
    nodeById.set(team.id, {
      team,
      children: [],
    })
  }

  const roots: TeamNode[] = []
  for (const node of nodeById.values()) {
    const parentId = node.team.parent?.id
    if (!parentId) {
      roots.push(node)
      continue
    }

    const parentNode = nodeById.get(parentId)
    if (!parentNode) {
      roots.push(node)
      continue
    }

    parentNode.children.push(node)
  }

  const sortNode = (nodes: TeamNode[]): TeamNode[] => {
    nodes.sort((left, right) => left.team.name.localeCompare(right.team.name))
    for (const child of nodes) {
      sortNode(child.children)
    }

    return nodes
  }

  return sortNode(roots)
}

export function flattenTeamTree(nodes: TeamNode[]): TeamFlatOption[] {
  const output: TeamFlatOption[] = []

  const visit = (items: TeamNode[], depth: number) => {
    for (const item of items) {
      output.push({
        team: item.team,
        depth,
      })

      if (item.children.length > 0) {
        visit(item.children, depth + 1)
      }
    }
  }

  visit(nodes, 0)
  return output
}

export function collectDirectCollaborators(
  repos: GithubRepo[],
  collaboratorsByRepo: Record<string, GithubCollaborator[]>,
): DirectCollaboratorSummary[] {
  const userMap = new Map<string, DirectCollaboratorSummary>()

  for (const repo of repos) {
    const collaborators = collaboratorsByRepo[repo.name] ?? []
    for (const collaborator of collaborators) {
      const login = collaborator.login
      const permission = normalizePermission(collaborator.permission)
      const existing = userMap.get(login)

      if (!existing) {
        userMap.set(login, {
          login,
          repos: {
            [repo.name]: permission,
          },
        })
        continue
      }

      const oldPermission = existing.repos[repo.name]
      if (!oldPermission || comparePermission(permission, oldPermission) > 0) {
        existing.repos[repo.name] = permission
      }
    }
  }

  return Array.from(userMap.values()).sort((left, right) =>
    left.login.localeCompare(right.login),
  )
}

export function toPermissionMap(
  repos: GithubRepo[],
  entries: RepoPermission[],
): Record<string, PermissionLevel> {
  const map: Record<string, PermissionLevel> = {}
  for (const repo of repos) {
    map[repo.name] = 'none'
  }

  for (const entry of entries) {
    if (!(entry.repoName in map)) {
      continue
    }

    const nextPermission = normalizePermission(entry.permission)
    const previous = map[entry.repoName]
    if (comparePermission(nextPermission, previous) > 0) {
      map[entry.repoName] = nextPermission
    }
  }

  return map
}
