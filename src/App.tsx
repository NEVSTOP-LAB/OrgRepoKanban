import { useEffect, useState } from 'react'

import './App.css'
import {
  applyOptimisticPermission,
  reconcileBatchResults,
} from './domain/batch'
import type { RepoFilterPreset } from './domain/board'
import { toggleSelection } from './domain/selection'
import {
  PERMISSION_DISPLAY_LABELS,
  type PermissionLevel,
} from './domain/permissions'
import { PermissionBoard } from './components/PermissionBoard'
import {
  buildTeamTreeOptions,
  collectDirectCollaborators,
  flattenTeamTree,
  toPermissionMap,
  type DirectCollaboratorSummary,
  type GithubCollaborator,
  type GithubRepo,
  type RepoPermission,
  type TeamFlatOption,
} from './github/data'
import { GithubClient } from './github/client'
import { executePermissionBatch } from './github/mutations'

type SubjectKind = 'team' | 'user'

interface Notice {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
  successRepos?: string[]
  failedRepos?: Array<{ repo: string; error: string }>
}

function buildEmptyPermissionMap(repos: GithubRepo[]): Record<string, PermissionLevel> {
  const map: Record<string, PermissionLevel> = {}
  for (const repo of repos) {
    map[repo.name] = 'none'
  }

  return map
}

function toUserPermissionMaps(
  repos: GithubRepo[],
  collaborators: DirectCollaboratorSummary[],
): Record<string, Record<string, PermissionLevel>> {
  const next: Record<string, Record<string, PermissionLevel>> = {}

  for (const collaborator of collaborators) {
    const entries: RepoPermission[] = Object.entries(collaborator.repos).map(
      ([repoName, permission]) => ({
        repoName,
        permission,
      }),
    )

    next[collaborator.login] = toPermissionMap(repos, entries)
  }

  return next
}

function formatTeamOption(option: TeamFlatOption): string {
  const indent = option.depth > 0 ? `${'　'.repeat(option.depth)}└ ` : ''
  return `${indent}${option.team.name}`
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function buildBatchNotice(
  target: PermissionLevel,
  successRepos: string[],
  failedRepos: Array<{ repo: string; error: string }>,
): Notice {
  const actionText =
    target === 'none' ? '移除授权' : `设置为 ${PERMISSION_DISPLAY_LABELS[target]}`

  if (failedRepos.length === 0) {
    return {
      tone: 'success',
      title: `已完成批量权限更新：${actionText}`,
      description: `成功处理 ${successRepos.length} 个仓库。`,
      successRepos,
    }
  }

  return {
    tone: 'warning',
    title: `批量权限更新部分完成：${actionText}`,
    description: `成功 ${successRepos.length} 个，失败 ${failedRepos.length} 个。`,
    successRepos,
    failedRepos,
  }
}

const REPO_FILTER_PRESETS: Array<{ key: RepoFilterPreset; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'public', label: '仅 Public' },
  { key: 'private', label: '仅 Private' },
  { key: 'forked', label: '仅 Forked' },
]

function App() {
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('')
  const [client, setClient] = useState<GithubClient | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [subjectLoading, setSubjectLoading] = useState(false)
  const [writing, setWriting] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [teamOptions, setTeamOptions] = useState<TeamFlatOption[]>([])
  const [teamPermissions, setTeamPermissions] = useState<
    Record<string, Record<string, PermissionLevel>>
  >({})
  const [users, setUsers] = useState<DirectCollaboratorSummary[]>([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [userPermissions, setUserPermissions] = useState<
    Record<string, Record<string, PermissionLevel>>
  >({})
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('team')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [filterPreset, setFilterPreset] = useState<RepoFilterPreset>('all')
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)

  const repoCards = repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    isPrivate: Boolean(repo.private),
    isFork: Boolean(repo.fork),
  }))

  const emptyPermissionMap = buildEmptyPermissionMap(repos)
  const currentPermissionMap =
    subjectKind === 'team'
      ? teamPermissions[selectedTeam] ?? emptyPermissionMap
      : userPermissions[selectedUser] ?? emptyPermissionMap

  const hasConnectedData = repos.length > 0 && isAdmin === true

  const updateCurrentSubjectPermissions = (nextMap: Record<string, PermissionLevel>) => {
    if (subjectKind === 'team') {
      setTeamPermissions((previous) => ({
        ...previous,
        [selectedTeam]: nextMap,
      }))
      return
    }

    setUserPermissions((previous) => ({
      ...previous,
      [selectedUser]: nextMap,
    }))
  }

  const loadCollaborators = async (
    activeClient: GithubClient,
    activeRepos: GithubRepo[],
    nextSelectedUser = '',
  ) => {
    setSubjectLoading(true)

    try {
      const collaboratorsByRepo: Record<string, GithubCollaborator[]> = {}
      for (const repo of activeRepos) {
        collaboratorsByRepo[repo.name] = await activeClient.listRepoDirectCollaborators(repo.name)
      }

      const summaries = collectDirectCollaborators(activeRepos, collaboratorsByRepo)
      const permissionMaps = toUserPermissionMaps(activeRepos, summaries)
      setUsers(summaries)
      setUserPermissions(permissionMaps)
      setUsersLoaded(true)

      const fallbackUser = nextSelectedUser || summaries[0]?.login || ''
      setSelectedUser(fallbackUser)
      if (summaries.length === 0) {
        setNotice({
          tone: 'info',
          title: '当前组织没有可管理的直接协作者。',
          description: '只有至少被直接授权到一个仓库的用户才会出现在列表中。',
        })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '加载直接协作者失败。',
        description: formatError(error, '无法从 GitHub 读取直接协作者信息。'),
      })
    } finally {
      setSubjectLoading(false)
    }
  }

  const connectOrganization = async (isRefresh = false) => {
    const trimmedToken = token.trim()
    const trimmedOrg = org.trim()

    if (!trimmedToken || !trimmedOrg) {
      setNotice({
        tone: 'warning',
        title: '请先填写个人访问令牌和组织名称。',
      })
      return
    }

    setNotice(null)
    setSelectedRepos(new Set())
    setFilterQuery('')
    setFilterPreset('all')
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setConnecting(true)
    }

    const nextClient = new GithubClient(trimmedToken, trimmedOrg)

    try {
      const admin = await nextClient.verifyOrgAdmin()
      setIsAdmin(admin)

      if (!admin) {
        setClient(null)
        setRepos([])
        setTeamOptions([])
        setTeamPermissions({})
        setUsers([])
        setUsersLoaded(false)
        setUserPermissions({})
        setSelectedTeam('')
        setSelectedUser('')
        setNotice({
          tone: 'warning',
          title: '当前令牌不是该组织管理员，无法执行权限修改。',
          description: '请使用具备 admin:org 和 repo 权限的组织管理员令牌重新连接。',
        })
        return
      }

      const [repoList, teams] = await Promise.all([
        nextClient.listOrgRepos(),
        nextClient.listTeams(),
      ])

      const flattenedTeams = flattenTeamTree(buildTeamTreeOptions(teams))
      const defaultTeam = flattenedTeams[0]?.team.slug ?? ''

      setClient(nextClient)
      setRepos(repoList)
      setTeamOptions(flattenedTeams)
      setTeamPermissions({})
      setUsers([])
      setUsersLoaded(false)
      setUserPermissions({})
      setSelectedUser('')
      setSubjectKind(defaultTeam ? 'team' : 'user')
      setSelectedTeam(defaultTeam)

      if (defaultTeam) {
        setSubjectLoading(true)
        const teamRepoPermissions = await nextClient.listTeamRepos(defaultTeam)
        setTeamPermissions({
          [defaultTeam]: toPermissionMap(repoList, teamRepoPermissions),
        })
        setSubjectLoading(false)
      } else {
        await loadCollaborators(nextClient, repoList)
      }

      setNotice({
        tone: 'success',
        title: `已连接组织 ${trimmedOrg}`,
        description: '当前页面仅在内存中持有令牌和组织名称，刷新页面后即失效。',
      })
    } catch (error) {
      setClient(null)
      setRepos([])
      setTeamOptions([])
      setTeamPermissions({})
      setUsers([])
      setUsersLoaded(false)
      setUserPermissions({})
      setSelectedTeam('')
      setSelectedUser('')
      setIsAdmin(null)
      setNotice({
        tone: 'error',
        title: '连接 GitHub 失败。',
        description: formatError(error, '请检查令牌权限、组织名称或网络连接。'),
      })
    } finally {
      setConnecting(false)
      setRefreshing(false)
      setSubjectLoading(false)
    }
  }

  useEffect(() => {
    if (!client || subjectKind !== 'team' || !selectedTeam || repos.length === 0) {
      return
    }

    if (teamPermissions[selectedTeam]) {
      return
    }

    let cancelled = false
    setSubjectLoading(true)

    void client
      .listTeamRepos(selectedTeam)
      .then((entries) => {
        if (cancelled) {
          return
        }

        setTeamPermissions((previous) => ({
          ...previous,
          [selectedTeam]: toPermissionMap(repos, entries),
        }))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setNotice({
          tone: 'error',
          title: '读取团队仓库权限失败。',
          description: formatError(error, '无法从 GitHub 获取该团队的仓库权限。'),
        })
      })
      .finally(() => {
        if (!cancelled) {
          setSubjectLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [client, repos, selectedTeam, subjectKind, teamPermissions])

  useEffect(() => {
    if (!client || subjectKind !== 'user' || repos.length === 0 || usersLoaded) {
      return
    }

    void loadCollaborators(client, repos, selectedUser)
  }, [client, repos, selectedUser, subjectKind, usersLoaded])

  useEffect(() => {
    setSelectedRepos(new Set())
  }, [selectedTeam, selectedUser, subjectKind])

  useEffect(() => {
    setSelectedRepos(new Set())
  }, [filterPreset, filterQuery])

  const handleMoveRequested = async (
    repoNames: string[],
    target: PermissionLevel,
  ) => {
    if (!client) {
      return
    }

    if (!isAdmin) {
      setNotice({
        tone: 'warning',
        title: '当前令牌没有管理员权限，不能修改授权。',
      })
      return
    }

    const subject =
      subjectKind === 'team'
        ? selectedTeam
          ? { kind: 'team' as const, key: selectedTeam }
          : null
        : selectedUser
          ? { kind: 'user' as const, key: selectedUser }
          : null

    if (!subject) {
      setNotice({
        tone: 'warning',
        title: '请先选择要管理的主体。',
      })
      return
    }

    const targetLabel =
      target === 'none' ? '未授权（移除权限）' : PERMISSION_DISPLAY_LABELS[target]
    const confirmed = window.confirm(
      `即将把 ${repoNames.length} 个仓库设置到 ${targetLabel}。是否继续？`,
    )
    if (!confirmed) {
      return
    }

    const previous = currentPermissionMap
    const optimistic = applyOptimisticPermission(previous, repoNames, target)
    updateCurrentSubjectPermissions(optimistic)
    setWriting(true)
    setNotice({
      tone: 'info',
      title: '正在提交批量权限变更。',
      description: `待处理仓库数：${repoNames.length}`,
    })

    const results = await executePermissionBatch(client, {
      subject,
      repoNames,
      target,
    })

    const settled = reconcileBatchResults(previous, optimistic, results)
    updateCurrentSubjectPermissions(settled.next)
    setNotice(buildBatchNotice(target, settled.success, settled.failed))
    setWriting(false)
  }

  const isBusy = connecting || refreshing || subjectLoading || writing

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">GitHub 组织仓库权限看板</span>
          <h1>把权限调整，拖进一个看板里。</h1>
          <p>
            选择团队或直接授权个人后，所有仓库只会出现在其最高有效权限列。支持实时过滤、Ctrl/Cmd 多选与批量拖拽修改。
          </p>
          <div className="badge-row">
            <span className="badge">仅限组织管理员写入</span>
            <span className="badge">支持 Read 到 Admin 全权限层级</span>
            <span className="badge">失败会回滚并对账最终结果</span>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <strong>凭据策略</strong>
            <span>PAT 与组织名仅保存在当前页面内存中，不会写入本地存储。</span>
          </div>
          <div className="meta-card">
            <strong>令牌权限</strong>
            <span>至少需要 admin:org 与 repo。</span>
          </div>
          <div className="meta-card">
            <strong>交互说明</strong>
            <span>按住 Ctrl 或 Cmd 点击卡片可跨列多选，再整体拖到目标列。</span>
          </div>
        </div>
      </section>

      <section className="control-panel">
        <div className="section-title">
          <div>
            <h2>认证与主体</h2>
            <p>本页不会保存 PAT 与组织名称，刷新页面后需重新输入。</p>
          </div>
        </div>

        <div className="connect-grid">
          <div className="field">
            <label htmlFor="token-input">个人访问令牌</label>
            <input
              id="token-input"
              aria-label="个人访问令牌"
              type="password"
              value={token}
              autoComplete="off"
              placeholder="ghp_xxx"
              onChange={(event) => setToken(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="org-input">组织名称</label>
            <input
              id="org-input"
              aria-label="组织名称"
              type="text"
              value={org}
              autoComplete="off"
              placeholder="your-org"
              onChange={(event) => setOrg(event.target.value)}
            />
          </div>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="primary-button"
            disabled={connecting || writing}
            onClick={() => {
              void connectOrganization(false)
            }}
          >
            {connecting ? '连接中...' : '连接组织'}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={!client || refreshing || writing}
            onClick={() => {
              void connectOrganization(true)
            }}
          >
            {refreshing ? '刷新中...' : '重新从 GitHub 加载'}
          </button>

          {isAdmin === false ? (
            <span className="readonly-tip">当前令牌无管理员权限，已阻止写操作。</span>
          ) : null}
        </div>

        {notice ? (
          <div className={`status-banner ${notice.tone}`} role="status">
            <strong>{notice.title}</strong>
            {notice.description ? <span>{notice.description}</span> : null}
          </div>
        ) : null}

        {hasConnectedData ? (
          <>
            <div className="badge-row">
              <span className="badge">仓库数：{repos.length}</span>
              <span className="badge">团队数：{teamOptions.length}</span>
              <span className="badge">直接协作者数：{usersLoaded ? users.length : '待加载'}</span>
            </div>

            <div className="subject-grid" style={{ marginTop: '18px' }}>
              <div className="field">
                <label htmlFor="subject-kind">主体类型</label>
                <select
                  id="subject-kind"
                  value={subjectKind}
                  onChange={(event) => setSubjectKind(event.target.value as SubjectKind)}
                >
                  <option value="team">团队</option>
                  <option value="user">直接授权个人协作者</option>
                </select>
              </div>

              {subjectKind === 'team' ? (
                <div className="field">
                  <label htmlFor="team-select">团队选择</label>
                  <select
                    id="team-select"
                    value={selectedTeam}
                    onChange={(event) => setSelectedTeam(event.target.value)}
                  >
                    {teamOptions.length === 0 ? (
                      <option value="">当前组织没有团队</option>
                    ) : null}
                    {teamOptions.map((option) => (
                      <option key={option.team.id} value={option.team.slug}>
                        {formatTeamOption(option)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="user-select">个人协作者</label>
                  <select
                    id="user-select"
                    value={selectedUser}
                    onChange={(event) => setSelectedUser(event.target.value)}
                    disabled={subjectLoading && !usersLoaded}
                  >
                    {users.length === 0 ? (
                      <option value="">
                        {usersLoaded ? '当前没有直接协作者' : '正在加载直接协作者'}
                      </option>
                    ) : null}
                    {users.map((user) => (
                      <option key={user.login} value={user.login}>
                        {user.login}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </>
        ) : null}
      </section>

      <section className="board-panel">
        <div className="section-title">
          <div>
            <h2>权限看板</h2>
            <p>卡片只显示在最高有效权限列。拖到“未授权”会移除权限。</p>
          </div>
        </div>

        {hasConnectedData ? (
          <>
            <div className="toolbar">
              <div className="toolbar-main">
                <div className="field toolbar-search">
                  <label htmlFor="repo-filter">按仓库名称过滤</label>
                  <input
                    id="repo-filter"
                    type="text"
                    value={filterQuery}
                    placeholder="支持包含或模糊匹配"
                    onChange={(event) => setFilterQuery(event.target.value)}
                  />
                </div>

                <div className="preset-filter-group" aria-label="仓库预置过滤">
                  {REPO_FILTER_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className={`ghost-button preset-filter-button ${
                        filterPreset === preset.key ? 'active' : ''
                      }`}
                      onClick={() => setFilterPreset(preset.key)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="toolbar-side">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!filterQuery}
                  onClick={() => setFilterQuery('')}
                >
                  清空过滤
                </button>
                <span className="badge">已选卡片：{selectedRepos.size}</span>
                <span className="badge">写入状态：{writing ? '提交中' : '空闲'}</span>
              </div>
            </div>

            {subjectLoading ? (
              <div className="empty-state">
                <strong>正在加载当前主体的权限快照...</strong>
                <span>读取完成后会自动刷新看板位置。</span>
              </div>
            ) : (
              <PermissionBoard
                repos={repoCards}
                permissionByRepo={currentPermissionMap}
                filterQuery={filterQuery}
                filterPreset={filterPreset}
                selectedRepos={selectedRepos}
                interactive={isAdmin === true && !isBusy}
                onToggleSelect={(repoName, additive) => {
                  setSelectedRepos((previous) => toggleSelection(previous, repoName, additive))
                }}
                onMoveRequested={(repoNames, target) => {
                  void handleMoveRequested(repoNames, target)
                }}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <strong>先完成组织连接，再开始拖拽管理权限。</strong>
            <span>只有组织管理员令牌会进入可用状态。</span>
          </div>
        )}
      </section>

      <section className="log-panel">
        <div className="section-title">
          <div>
            <h2>执行结果</h2>
            <p>批量变更发生部分失败时，这里会列出成功与失败的仓库名单。</p>
          </div>
        </div>

        {notice?.successRepos?.length || notice?.failedRepos?.length ? (
          <div className="log-columns">
            <div className="log-box">
              <h3>成功仓库</h3>
              <ul>
                {(notice.successRepos ?? []).map((repoName) => (
                  <li key={repoName}>{repoName}</li>
                ))}
              </ul>
            </div>

            <div className="log-box">
              <h3>失败仓库</h3>
              <ul>
                {(notice.failedRepos ?? []).map((item) => (
                  <li key={item.repo}>
                    {item.repo}：{item.error}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <strong>暂无批量执行记录。</strong>
            <span>完成一次拖拽授权后，这里会展示成功与失败的详细结果。</span>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
