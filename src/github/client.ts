import { normalizePermission, type PermissionLevel } from '../domain/permissions'
import type {
  GithubCollaborator,
  GithubRepo,
  GithubTeam,
  OrgMember,
} from './data'

export interface HttpError extends Error {
  status: number
  message: string
  requestUrl: string
}

interface OrgMembershipResponse {
  role?: string
}

interface TeamRepoResponse {
  name: string
  permissions?: {
    pull?: boolean
    triage?: boolean
    push?: boolean
    maintain?: boolean
    admin?: boolean
  }
  role_name?: string
}

interface UserRepoPermissionResponse {
  permission?: string
  role_name?: string
}

export interface TeamRepoPermission {
  repoName: string
  permission: PermissionLevel
}

export class GithubClient {
  private readonly token: string
  private readonly org: string
  private readonly baseUrl: string

  constructor(token: string, org: string, baseUrl = 'https://api.github.com') {
    this.token = token
    this.org = org
    this.baseUrl = baseUrl
  }

  async verifyOrgAdmin(): Promise<boolean> {
    const membership = await this.request<OrgMembershipResponse>(
      `/user/memberships/orgs/${encodeURIComponent(this.org)}`,
    )
    return membership.role === 'admin'
  }

  async listOrgRepos(): Promise<GithubRepo[]> {
    return this.paginate<GithubRepo[]>(`/orgs/${encodeURIComponent(this.org)}/repos?per_page=100&type=all`)
  }

  async listTeams(): Promise<GithubTeam[]> {
    return this.paginate<GithubTeam[]>(`/orgs/${encodeURIComponent(this.org)}/teams?per_page=100`)
  }

  async listTeamRepos(teamSlug: string): Promise<TeamRepoPermission[]> {
    const repos = await this.paginate<TeamRepoResponse[]>(
      `/orgs/${encodeURIComponent(this.org)}/teams/${encodeURIComponent(teamSlug)}/repos?per_page=100`,
    )

    return repos.map((repo) => ({
      repoName: repo.name,
      permission: this.extractPermission(repo),
    }))
  }

  async listRepoDirectCollaborators(repoName: string): Promise<GithubCollaborator[]> {
    return this.paginate<GithubCollaborator[]>(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/collaborators?affiliation=direct&per_page=100`,
    )
  }

  async listOrgMembers(): Promise<OrgMember[]> {
    return this.paginate<OrgMember[]>(
      `/orgs/${encodeURIComponent(this.org)}/members?per_page=100`,
    )
  }

  async getUserRepoPermission(repoName: string, userLogin: string): Promise<PermissionLevel> {
    const response = await this.request<UserRepoPermissionResponse>(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/collaborators/${encodeURIComponent(userLogin)}/permission`,
    )
    if (response.role_name) {
      const byRoleName = normalizePermission(response.role_name)
      if (byRoleName !== 'none') {
        return byRoleName
      }
    }
    return normalizePermission(response.permission ?? 'none')
  }

  async listUserTeams(userLogin: string): Promise<string[]> {
    const teams = await this.paginate<GithubTeam[]>(
      `/orgs/${encodeURIComponent(this.org)}/teams?per_page=100`,
    )

    const results = await Promise.all(
      teams.map(async (team) => {
        try {
          await this.requestVoid(
            `/orgs/${encodeURIComponent(this.org)}/teams/${encodeURIComponent(team.slug)}/memberships/${encodeURIComponent(userLogin)}`,
          )
          return team.slug
        } catch (error) {
          if ((error as HttpError).status === 404) {
            return null
          }
          throw error
        }
      }),
    )

    return results.filter((slug): slug is string => slug !== null)
  }

  async setTeamRepoPermission(
    teamSlug: string,
    repoName: string,
    permission: PermissionLevel,
  ): Promise<void> {
    await this.requestVoid(
      `/orgs/${encodeURIComponent(this.org)}/teams/${encodeURIComponent(teamSlug)}/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ permission }),
      },
    )
  }

  async removeTeamRepoPermission(teamSlug: string, repoName: string): Promise<void> {
    await this.requestVoid(
      `/orgs/${encodeURIComponent(this.org)}/teams/${encodeURIComponent(teamSlug)}/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}`,
      {
        method: 'DELETE',
      },
    )
  }

  async setUserRepoPermission(
    repoName: string,
    userLogin: string,
    permission: PermissionLevel,
  ): Promise<void> {
    await this.requestVoid(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/collaborators/${encodeURIComponent(userLogin)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ permission }),
      },
    )
  }

  async removeUserRepoPermission(repoName: string, userLogin: string): Promise<void> {
    await this.requestVoid(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/collaborators/${encodeURIComponent(userLogin)}`,
      {
        method: 'DELETE',
      },
    )
  }

  private async paginate<T>(path: string): Promise<T extends Array<infer U> ? U[] : never> {
    const rows: unknown[] = []
    let next: string | null = path

    while (next) {
      const response = await this.rawRequest(next)
      const payload = (await this.parseJson(response)) as unknown
      if (Array.isArray(payload)) {
        rows.push(...payload)
      }

      next = this.extractNextUrl(response.headers.get('link'))
    }

    return rows as T extends Array<infer U> ? U[] : never
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.rawRequest(path, init)
    return this.parseJson(response) as Promise<T>
  }

  private async requestVoid(path: string, init?: RequestInit): Promise<void> {
    await this.rawRequest(path, init)
  }

  private async rawRequest(pathOrUrl: string, init?: RequestInit): Promise<Response> {
    const requestUrl = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`

    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${this.token}`)
    headers.set('accept', 'application/vnd.github+json')
    headers.set('x-github-api-version', '2022-11-28')
    if (init?.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const response = await fetch(requestUrl, {
      ...init,
      headers,
    })

    if (response.ok) {
      return response
    }

    const message = await this.extractErrorMessage(response)
    const error = new Error(message) as HttpError
    error.status = response.status
    error.message = message
    error.requestUrl = requestUrl
    throw error
  }

  private async parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) {
      return null
    }

    const contentType = response.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      return null
    }

    return response.json()
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      const payload = (await response.json()) as { message?: string }
      if (payload.message) {
        return payload.message
      }
    }

    return `请求失败 (${response.status})`
  }

  private extractPermission(repo: TeamRepoResponse): PermissionLevel {
    if (repo.role_name) {
      const byRoleName = normalizePermission(repo.role_name)
      if (byRoleName !== 'none') {
        return byRoleName
      }
    }

    const permissions = repo.permissions
    if (!permissions) {
      return 'none'
    }

    if (permissions.admin) {
      return 'admin'
    }

    if (permissions.maintain) {
      return 'maintain'
    }

    if (permissions.push) {
      return 'push'
    }

    if (permissions.triage) {
      return 'triage'
    }

    if (permissions.pull) {
      return 'pull'
    }

    return 'none'
  }

  private extractNextUrl(linkHeader: string | null): string | null {
    if (!linkHeader) {
      return null
    }

    const segments = linkHeader.split(',')
    for (const segment of segments) {
      if (!segment.includes('rel="next"')) {
        continue
      }

      const match = segment.match(/<([^>]+)>/)
      if (match?.[1]) {
        return match[1]
      }
    }

    return null
  }
}
