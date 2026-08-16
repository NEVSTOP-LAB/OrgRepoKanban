import {
  comparePermission,
  normalizePermission,
  type PermissionLevel,
} from '../domain/permissions'

export interface GithubRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  private?: boolean
  fork?: boolean
  pushed_at?: string | null
  topics?: string[]
  accessList?: RepoAccessEntry[]
}

export interface RepoAccessEntry {
  kind: 'team' | 'user'
  name: string
  permission: PermissionLevel
}

export interface RepoTeamAccess {
  slug?: string
  name: string
  permission?: string
}

export interface RepoCollaboratorAccess {
  login: string
  role_name?: string
  permissions?: {
    admin?: boolean
    maintain?: boolean
    push?: boolean
    triage?: boolean
  }
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

export interface OrgMember {
  login: string
  id: number
}

export interface RunnerLabel {
  id: number
  name: string
  type?: string
}

export interface OrgRunner {
  id: number
  name: string
  os: string
  status: 'online' | 'offline'
  busy: boolean
  labels: RunnerLabel[]
  /** 忙碌 runner 当前正在执行的 job（由进行中 workflow runs 的 job 匹配而来） */
  currentJob?: RunnerJobInfo | null
}

/** 忙碌 runner 正在执行的 workflow job 摘要（点击跳转到 GitHub 上的运行详情页） */
export interface RunnerJobInfo {
  /** 执行该 job 的 runner 名称，用于与 OrgRunner.name 匹配 */
  runnerName: string
  repoName: string
  /** workflow 名称（run.name） */
  workflowName: string
  /** 运行标题（run.display_title），优先用于展示 */
  displayTitle: string
  /** job 名称 */
  jobName: string
  runNumber: number
  /** 运行详情页链接（GitHub Actions 页面） */
  htmlUrl: string
  /** job 开始时间 */
  startedAt: string
}

export interface QueuedWorkflowRun {
  id: number
  repoName: string
  name: string
  displayTitle: string
  runNumber: number
  event: string
  headBranch: string
  headSha: string
  htmlUrl: string
  createdAt: string
  actor: string
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
