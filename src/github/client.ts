import { normalizePermission, type PermissionLevel } from '../domain/permissions'
import type {
  GithubCollaborator,
  GithubRepo,
  GithubTeam,
  OrgMember,
  OrgRunner,
  QueuedWorkflowRun,
  RecentWorkflowRun,
  RepoAccessEntry,
  RepoCollaboratorAccess,
  RepoTeamAccess,
  RunnerJobInfo,
} from './data'
import type { OrgSecret, RepoSecretInfo } from '../domain/secret'
import { encryptSecret } from './secrets'

export interface HttpError extends Error {
  status: number
  message: string
  requestUrl: string
  /** 响应头 x-ratelimit-remaining 的值，用于区分限流与权限拒绝 */
  rateLimitRemaining?: string | null
  /** 响应头 retry-after 的秒数，存在即代表次级限流 */
  retryAfterSeconds?: number | null
}

/** 判断错误是否由 GitHub 主/次级限流引起（403/429 且带限流特征） */
export function isRateLimitedError(error: unknown): boolean {
  if (error instanceof Error) {
    const httpError = error as HttpError
    if (httpError.status === 429) {
      return true
    }
    if (httpError.status === 403) {
      return (
        httpError.rateLimitRemaining === '0' ||
        (typeof httpError.retryAfterSeconds === 'number' && httpError.retryAfterSeconds >= 0)
      )
    }
  }
  return false
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

interface WorkflowRunResponse {
  id: number
  workflow_id?: number
  name: string
  display_title?: string
  run_number: number
  event: string
  head_branch: string
  head_sha: string
  html_url: string
  created_at: string
  updated_at?: string | null
  run_started_at?: string | null
  status?: string
  conclusion?: string | null
  actor?: { login?: string } | null
}

interface WorkflowResponse {
  id: number
}

interface WorkflowRunJobResponse {
  id: number
  name: string
  status: string
  started_at: string
  html_url: string
  /** 自托管 runner 的名称；托管 runner 为 null */
  runner_name?: string | null
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

  async getRepoTopics(repoName: string): Promise<string[]> {
    const response = await this.rawRequest(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/topics`,
      {
        headers: new Headers({ accept: 'application/vnd.github.mercy-preview+json' }),
      },
    )
    const payload = (await this.parseJson(response)) as { names?: string[] } | null
    return payload?.names ?? []
  }

  async getRepoAccessList(repoName: string): Promise<RepoAccessEntry[]> {
    const [teams, collaborators] = await Promise.all([
      this.paginate<RepoTeamAccess[]>(
        `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/teams?per_page=100`,
      ),
      this.paginate<RepoCollaboratorAccess[]>(
        `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/collaborators?per_page=100&affiliation=direct`,
      ),
    ])

    const entries: RepoAccessEntry[] = []

    for (const team of teams) {
      const perm = normalizePermission(team.permission ?? 'none')
      if (perm !== 'none') {
        entries.push({ kind: 'team', name: team.slug ?? team.name, permission: perm })
      }
    }

    for (const user of collaborators) {
      const perm = normalizePermission(user.permissions?.admin ? 'admin'
        : user.permissions?.maintain ? 'maintain'
        : user.permissions?.push ? 'push'
        : user.permissions?.triage ? 'triage'
        : user.role_name ? user.role_name
        : 'none')
      // Only include direct (non-team-inherited) collaborators
      if (perm !== 'none') {
        entries.push({ kind: 'user', name: user.login, permission: perm })
      }
    }

    return entries
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

  // ── Actions runners & workflow runs ───────────────────────────────────

  async listOrgRunners(): Promise<OrgRunner[]> {
    const allRunners: OrgRunner[] = []
    let next: string | null =
      `/orgs/${encodeURIComponent(this.org)}/actions/runners?per_page=100`

    while (next) {
      const response = await this.rawRequest(next)
      const payload = (await this.parseJson(response)) as { runners?: OrgRunner[] } | null
      allRunners.push(...(payload?.runners ?? []))

      next = this.extractNextUrl(response.headers.get('link'))
    }

    return allRunners
  }

  /** 仓库不可读取（未启用 Actions / 无权限 / 不存在）时返回 null，与「无排队」区分 */
  async listQueuedWorkflowRuns(repoName: string): Promise<QueuedWorkflowRun[] | null> {
    try {
      const allRuns: QueuedWorkflowRun[] = []
      let next: string | null =
        `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/runs?status=queued&per_page=100`

      while (next) {
        const response = await this.rawRequest(next)
        const payload = (await this.parseJson(response)) as {
          workflow_runs?: WorkflowRunResponse[]
        } | null

        for (const run of payload?.workflow_runs ?? []) {
          allRuns.push({
            id: run.id,
            repoName,
            name: run.name,
            displayTitle: run.display_title ?? run.name,
            runNumber: run.run_number,
            event: run.event,
            headBranch: run.head_branch,
            headSha: run.head_sha,
            htmlUrl: run.html_url,
            createdAt: run.created_at,
            actor: run.actor?.login ?? '',
          })
        }

        next = this.extractNextUrl(response.headers.get('link'))
      }

      return allRuns
    } catch (error) {
      // 仓库未启用 Actions / 令牌无权限 / 仓库不存在 → null（UI 计入跳过）；
      // 403 若带限流特征（x-ratelimit-remaining=0 / retry-after）则继续抛出，避免静默丢失数据
      const status = (error as { status?: number }).status
      const unavailable =
        status === 404 || status === 409 || (status === 403 && !isRateLimitedError(error))
      if (unavailable) {
        return null
      }

      throw error
    }
  }

  /**
   * 汇总指定仓库内正在执行的 jobs，仅保留 runner 名称匹配的条目，
   * 用于在 Runner 看板展示「忙碌 runner 当前运行的 workflow」并可跳转到 GitHub 运行详情页。
   * 仓库不可读（未启用 Actions / 无权限 / 不存在）时返回 null，与 listQueuedWorkflowRuns 口径一致；
   * runner 名单为空时直接返回 []（不发起任何请求）。
   */
  async listRecentWorkflowRuns(
    repoName: string,
    cutoffMs = 30 * 24 * 60 * 60 * 1000,
  ): Promise<RecentWorkflowRun[] | null> {
    try {
      const cutoff = Date.now() - cutoffMs
      const allRuns: RecentWorkflowRun[] = []
      const workflowIds = new Set<number>()
      let workflowNext: string | null =
        `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/workflows?per_page=100`

      while (workflowNext) {
        const response = await this.rawRequest(workflowNext)
        const payload = (await this.parseJson(response)) as {
          workflows?: WorkflowResponse[]
        } | null
        for (const workflow of payload?.workflows ?? []) {
          workflowIds.add(workflow.id)
        }
        workflowNext = this.extractNextUrl(response.headers.get('link'))
      }

      let next: string | null = `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/runs?per_page=100`

      while (next) {
        const response = await this.rawRequest(next)
        const payload = (await this.parseJson(response)) as {
          workflow_runs?: WorkflowRunResponse[]
        } | null

        let pageHasRunsBeforeCutoff = false
        for (const run of payload?.workflow_runs ?? []) {
          if (run.workflow_id === undefined || !workflowIds.has(run.workflow_id)) {
            continue
          }

          const startedAt = run.run_started_at ?? run.created_at
          const status = run.status ?? 'completed'
          const completedAt = status === 'completed' ? (run.updated_at ?? run.created_at) : null
          const timestamp = Date.parse(completedAt ?? startedAt)
          if (!Number.isNaN(timestamp) && timestamp < cutoff) {
            pageHasRunsBeforeCutoff = true
            continue
          }

          allRuns.push({
            id: run.id,
            repoName,
            workflowId: run.workflow_id,
            workflowName: run.name,
            displayTitle: run.display_title ?? run.name,
            runNumber: run.run_number,
            event: run.event,
            headBranch: run.head_branch,
            htmlUrl: run.html_url,
            startedAt,
            completedAt,
            createdAt: run.created_at,
            actor: run.actor?.login ?? '',
            status,
            conclusion: run.conclusion ?? null,
            success: run.conclusion === 'success',
          })
        }

        if (pageHasRunsBeforeCutoff) {
          break
        }

        next = this.extractNextUrl(response.headers.get('link'))
      }

      return allRuns
    } catch (error) {
      const status = (error as { status?: number }).status
      const unavailable =
        status === 404 || status === 409 || (status === 403 && !isRateLimitedError(error))
      if (unavailable) {
        return null
      }

      throw error
    }
  }

  async listBusyRunnerJobs(
    repoName: string,
    runnerNames: ReadonlySet<string>,
  ): Promise<RunnerJobInfo[] | null> {
    if (runnerNames.size === 0) {
      return []
    }

    try {
      // 1. 分页读取 status=in_progress 的 workflow runs
      const allRuns: QueuedWorkflowRun[] = []
      let next: string | null =
        `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/runs?status=in_progress&per_page=100`

      while (next) {
        const response = await this.rawRequest(next)
        const payload = (await this.parseJson(response)) as {
          workflow_runs?: WorkflowRunResponse[]
        } | null

        for (const run of payload?.workflow_runs ?? []) {
          allRuns.push({
            id: run.id,
            repoName,
            name: run.name,
            displayTitle: run.display_title ?? run.name,
            runNumber: run.run_number,
            event: run.event,
            headBranch: run.head_branch,
            headSha: run.head_sha,
            htmlUrl: run.html_url,
            createdAt: run.created_at,
            actor: run.actor?.login ?? '',
          })
        }

        next = this.extractNextUrl(response.headers.get('link'))
      }

      // 2. 并行读取每个 run 的 jobs，仅保留 runner_name 命中名单的条目
      const matchedByRun = await Promise.all(
        allRuns.map(async (run) => {
          try {
            const jobs = await this.fetchRunJobs(repoName, run.id)
            return jobs
              .filter((job) => runnerNames.has(job.runner_name ?? ''))
              .map((job): RunnerJobInfo => ({
                runnerName: job.runner_name ?? '',
                repoName,
                workflowName: run.name,
                displayTitle: run.displayTitle,
                jobName: job.name,
                runNumber: run.runNumber,
                htmlUrl: run.htmlUrl,
                startedAt: job.started_at,
              }))
          } catch {
            // 单个 run 的 jobs 读取失败不阻塞整体扫描，下次刷新会自动重试
            return [] as RunnerJobInfo[]
          }
        }),
      )

      return matchedByRun.flat()
    } catch (error) {
      // 与 listQueuedWorkflowRuns 相同的「仓库不可读」判定
      const status = (error as { status?: number }).status
      const unavailable =
        status === 404 || status === 409 || (status === 403 && !isRateLimitedError(error))
      if (unavailable) {
        return null
      }

      throw error
    }
  }

  // ── Actions secrets ────────────────────────────────────────────────────

  async listOrgSecrets(): Promise<OrgSecret[]> {
    try {
      const allSecrets: OrgSecret[] = []
      let page = 1
      const perPage = 100

      while (true) {
        const result = await this.request<{ secrets: OrgSecret[]; total_count: number }>(
          `/orgs/${encodeURIComponent(this.org)}/actions/secrets?per_page=${perPage}&page=${page}`,
        )

        const secrets = result.secrets ?? []
        allSecrets.push(...secrets)

        if (secrets.length < perPage || allSecrets.length >= (result.total_count ?? 0)) {
          break
        }

        page++
      }

      return allSecrets
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return []
      }

      throw error
    }
  }

  async listRepoSecrets(repoName: string): Promise<RepoSecretInfo[]> {
    try {
      const allSecrets: RepoSecretInfo[] = []
      let page = 1
      const perPage = 100

      while (true) {
        const result = await this.request<{ secrets: RepoSecretInfo[]; total_count: number }>(
          `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/secrets?per_page=${perPage}&page=${page}`,
        )

        const secrets = result.secrets ?? []
        allSecrets.push(...secrets)

        if (secrets.length < perPage || allSecrets.length >= (result.total_count ?? 0)) {
          break
        }

        page++
      }

      return allSecrets
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return []
      }

      throw error
    }
  }

  async getRepoPublicKey(repoName: string): Promise<{ key_id: string; key: string }> {
    return this.request<{ key_id: string; key: string }>(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/secrets/public-key`,
    )
  }

  async setRepoSecret(
    repoName: string,
    secretName: string,
    plaintextValue: string,
  ): Promise<void> {
    const publicKey = await this.getRepoPublicKey(repoName)
    const encrypted = await encryptSecret(plaintextValue, publicKey.key)

    await this.requestVoid(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/secrets/${encodeURIComponent(secretName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          encrypted_value: encrypted,
          key_id: publicKey.key_id,
        }),
      },
    )
  }

  async deleteRepoSecret(
    repoName: string,
    secretName: string,
  ): Promise<void> {
    await this.requestVoid(
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/secrets/${encodeURIComponent(secretName)}`,
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
    error.rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
    const retryAfter = response.headers.get('retry-after')
    error.retryAfterSeconds = retryAfter === null ? null : Number(retryAfter)
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

  /** 分页读取单个 workflow run 的全部 jobs（原始响应，供 listBusyRunnerJobs 过滤 runner 匹配项） */
  private async fetchRunJobs(
    repoName: string,
    runId: number,
  ): Promise<WorkflowRunJobResponse[]> {
    const allJobs: WorkflowRunJobResponse[] = []
    let next: string | null =
      `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repoName)}/actions/runs/${runId}/jobs?per_page=100`

    while (next) {
      const response = await this.rawRequest(next)
      const payload = (await this.parseJson(response)) as { jobs?: WorkflowRunJobResponse[] } | null
      allJobs.push(...(payload?.jobs ?? []))
      next = this.extractNextUrl(response.headers.get('link'))
    }

    return allJobs
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
