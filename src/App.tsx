import { useEffect, useRef, useState } from 'react'

import './App.css'
import {
  applyOptimisticPermission,
  reconcileBatchResults,
} from './domain/batch'
import type { InheritedFilter, RepoFilterPreset } from './domain/board'
import { toggleSelection } from './domain/selection'
import {
  PERMISSION_DISPLAY_LABELS,
  comparePermission,
  type PermissionLevel,
} from './domain/permissions'
import { PermissionBoard } from './components/PermissionBoard'
import {
  buildTeamTreeOptions,
  flattenTeamTree,
  toPermissionMap,
  type GithubRepo,
  type OrgMember,
  type TeamFlatOption,
} from './github/data'
import { GithubClient } from './github/client'
import { executePermissionBatch } from './github/mutations'

type SubjectKind = 'team' | 'user'

type PermissionSubject =
  | { kind: 'team'; key: string }
  | { kind: 'user'; key: string }

interface QueuedMove {
  client: GithubClient
  subject: PermissionSubject
  repoNames: string[]
  target: PermissionLevel
}

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

function buildQueueNotice(move: QueuedMove): Notice {
  const prefix = move.repoNames.length > 1 ? '批量移动已确认，已加入操作队列。' : '单个移动已加入操作队列。'

  return {
    tone: 'info',
    title: prefix,
    description: `待处理仓库数：${move.repoNames.length}`,
  }
}

const REPO_FILTER_PRESETS: Array<{ key: RepoFilterPreset; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: '⊡' },
  { key: 'public', label: '公开', icon: '🔓' },
  { key: 'private', label: '私有', icon: '🔒' },
  { key: 'forked', label: 'Fork', icon: '⑂' },
]

const INHERITED_FILTER_PRESETS: Array<{ key: InheritedFilter; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: '⊡' },
  { key: 'inherited-only', label: '继承', icon: '⤵' },
  { key: 'direct-only', label: '直接', icon: '⤴' },
]

function App() {
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('')
  const [client, setClient] = useState<GithubClient | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [subjectLoading, setSubjectLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<{ completed: number; total: number } | null>(null)
  const [activeOps, setActiveOps] = useState({ reads: 0, writes: 0 })
  const writing = activeOps.writes > 0

  const addReadOp = () => setActiveOps((prev) => ({ ...prev, reads: prev.reads + 1 }))
  const removeReadOp = () => setActiveOps((prev) => ({ ...prev, reads: Math.max(0, prev.reads - 1) }))
  const addWriteOp = () => setActiveOps((prev) => ({ ...prev, writes: prev.writes + 1 }))
  const removeWriteOp = () => setActiveOps((prev) => ({ ...prev, writes: Math.max(0, prev.writes - 1) }))
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [teamOptions, setTeamOptions] = useState<TeamFlatOption[]>([])
  const [teamPermissions, setTeamPermissions] = useState<
    Record<string, Record<string, PermissionLevel>>
  >({})
  const [users, setUsers] = useState<OrgMember[]>([])
  const [userPermissions, setUserPermissions] = useState<
    Record<string, Record<string, PermissionLevel>>
  >({})
  const [userTeamPermissions, setUserTeamPermissions] = useState<
    Record<string, Record<string, PermissionLevel>>
  >({})
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('team')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [filterPreset, setFilterPreset] = useState<RepoFilterPreset>('private')
  const [inheritedFilter, setInheritedFilter] = useState<InheritedFilter>('all')
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const reposRef = useRef<GithubRepo[]>([])
  const teamPermissionsRef = useRef<Record<string, Record<string, PermissionLevel>>>({})
  const userPermissionsRef = useRef<Record<string, Record<string, PermissionLevel>>>({})
  const queueChainRef = useRef<Promise<void>>(Promise.resolve())

  const repoCards = repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    isPrivate: Boolean(repo.private),
    isFork: Boolean(repo.fork),
    topics: repo.topics ?? [],
    accessList: repo.accessList ?? [],
  }))

  // Progressive background loader: fetches topics + access lists and updates state per-repo
  async function loadRepoTags(activeClient: GithubClient, repoList: GithubRepo[]) {
    const CONCURRENCY = 8
    const queue = [...repoList]
    const results = new Map<number, { topics: string[]; accessList: typeof repoList[0]['accessList'] }>()
    setActiveOps((prev) => ({ ...prev, reads: prev.reads + repoList.length }))

    const worker = async () => {
      while (queue.length > 0) {
        const repo = queue.shift()!
        try {
          const [topics, accessList] = await Promise.all([
            activeClient.getRepoTopics(repo.name),
            activeClient.getRepoAccessList(repo.name),
          ])
          results.set(repo.id, { topics, accessList })
        } catch {
          results.set(repo.id, { topics: [], accessList: [] })
        }

        removeReadOp()
        setRepos((prev) =>
          prev.map((r) => {
            const done = results.get(r.id)
            if (done) {
              return { ...r, topics: done.topics, accessList: done.accessList }
            }
            return r
          }),
        )
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repoList.length) }, () => worker()))
  }

  // Refresh access tags for specific repos (called after permission changes)
  async function refreshRepoTags(activeClient: GithubClient, repoNames: string[]) {
    const nameSet = new Set(repoNames)
    for (const repoName of repoNames) {
      addReadOp()
      try {
        const accessList = await activeClient.getRepoAccessList(repoName)
        setRepos((prev) =>
          prev.map((r) => (r.name === repoName ? { ...r, accessList } : r)),
        )
      } catch {
        // keep existing tags on failure
      } finally {
        removeReadOp()
      }
    }
  }

  const emptyPermissionMap = buildEmptyPermissionMap(repos)
  const currentPermissionMap =
    subjectKind === 'team'
      ? teamPermissions[selectedTeam] ?? emptyPermissionMap
      : userPermissions[selectedUser] ?? emptyPermissionMap

  const selectedTeamOption = teamOptions.find((opt) => opt.team.slug === selectedTeam)
  const parentTeamSlug = selectedTeamOption?.team.parent?.slug ?? null
  const currentParentPermissionMap =
    subjectKind === 'team' && parentTeamSlug
      ? teamPermissions[parentTeamSlug] ?? null
      : subjectKind === 'user' && selectedUser
        ? userTeamPermissions[selectedUser] ?? null
        : null

  const hasConnectedData = repos.length > 0 && isAdmin === true

  const updateSubjectPermissions = (
    subject: PermissionSubject,
    nextMap: Record<string, PermissionLevel>,
  ) => {
    if (subject.kind === 'team') {
      setTeamPermissions((previous) => ({
        ...previous,
        [subject.key]: nextMap,
      }))
      return
    }

    setUserPermissions((previous) => ({
      ...previous,
      [subject.key]: nextMap,
    }))
  }

  const getSubjectPermissions = (subject: PermissionSubject) => {
    const fallback = buildEmptyPermissionMap(reposRef.current)
    if (subject.kind === 'team') {
      return teamPermissionsRef.current[subject.key] ?? fallback
    }

    return userPermissionsRef.current[subject.key] ?? fallback
  }

  const loadUserPermissions = async (
    activeClient: GithubClient,
    activeRepos: GithubRepo[],
    userLogin: string,
  ) => {
    if (!userLogin) return
    setLoadingProgress({ completed: 0, total: activeRepos.length })

    try {
      // Try to derive permissions from cached accessList (fast path)
      const reposWithCache = activeRepos.filter((r) => r.accessList && r.accessList.length > 0)
      const reposWithoutCache = activeRepos.filter((r) => !r.accessList || r.accessList.length === 0)
      const totalOps = reposWithoutCache.length + 1 // +1 for listUserTeams
      setActiveOps((prev) => ({ ...prev, reads: prev.reads + totalOps }))

      const permissionMap: Record<string, PermissionLevel> = {}
      let completed = 0

      // Fast path: derive direct permissions from cached accessList
      for (const repo of reposWithCache) {
        const entry = repo.accessList!.find((e) => e.kind === 'user' && e.name === userLogin)
        permissionMap[repo.name] = entry?.permission ?? 'none'
        completed++
        setLoadingProgress({ completed, total: activeRepos.length })
      }

      // Slow path: fetch missing repos via API
      if (reposWithoutCache.length > 0) {
        const CONCURRENCY = 6
        const queue = [...reposWithoutCache]
        const runWorker = async () => {
          while (queue.length > 0) {
            const repo = queue.shift()!
            try {
              permissionMap[repo.name] = await activeClient.getUserRepoPermission(repo.name, userLogin)
            } catch {
              permissionMap[repo.name] = 'none'
            }
            completed++
            removeReadOp()
            setLoadingProgress({ completed, total: activeRepos.length })
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reposWithoutCache.length) }, () => runWorker()))
      }

      setUserPermissions((previous) => ({
        ...previous,
        [userLogin]: permissionMap,
      }))

      // Derive team-inherited permissions from cached accessList
      const userTeams = await activeClient.listUserTeams(userLogin)
      removeReadOp()
      const teamSet = new Set(userTeams)

      if (teamSet.size > 0) {
        const teamPermMap: Record<string, PermissionLevel> = {}
        for (const repo of activeRepos) {
          teamPermMap[repo.name] = 'none'
          if (repo.accessList) {
            for (const entry of repo.accessList) {
              if (entry.kind === 'team' && teamSet.has(entry.name)) {
                const current = teamPermMap[repo.name] ?? 'none'
                if (comparePermission(entry.permission, current) > 0) {
                  teamPermMap[repo.name] = entry.permission
                }
              }
            }
          }
        }
        setUserTeamPermissions((previous) => ({
          ...previous,
          [userLogin]: teamPermMap,
        }))
      } else {
        setUserTeamPermissions((previous) => ({
          ...previous,
          [userLogin]: buildEmptyPermissionMap(activeRepos),
        }))
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '加载用户权限失败。',
        description: formatError(error, '无法从 GitHub 读取用户权限信息。'),
      })
    } finally {
      setLoadingProgress(null)
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
    setFilterPreset('private')
    setInheritedFilter('all')
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
        setUserPermissions({})
        setUserTeamPermissions({})
        setSelectedTeam('')
        setSelectedUser('')
        setNotice({
          tone: 'warning',
          title: '当前令牌不是该组织管理员，无法执行权限修改。',
          description: '请使用具备 admin:org 和 repo 权限的组织管理员令牌重新连接。',
        })
        return
      }

      const [repoList, teams, members] = await Promise.all([
        nextClient.listOrgRepos(),
        nextClient.listTeams(),
        nextClient.listOrgMembers(),
      ])

      const flattenedTeams = flattenTeamTree(buildTeamTreeOptions(teams))
      const defaultTeam = flattenedTeams[0]?.team.slug ?? ''

      const nextSubjectKind = defaultTeam
        ? (isRefresh ? subjectKind : 'team')
        : 'user'

      setClient(nextClient)
      setRepos(repoList)
      setTeamOptions(flattenedTeams)
      setTeamPermissions({})
      setUsers(members)
      setUserPermissions({})
      setUserTeamPermissions({})
      setSelectedUser(members[0]?.login ?? '')
      setSubjectKind(nextSubjectKind)
      setSelectedTeam(defaultTeam)

      // Load team permissions first so the board shows immediately
      if (nextSubjectKind === 'team' && defaultTeam) {
        setSubjectLoading(true)
        const teamRepoPermissions = await nextClient.listTeamRepos(defaultTeam)
        setTeamPermissions({
          [defaultTeam]: toPermissionMap(repoList, teamRepoPermissions),
        })
        setSubjectLoading(false)
      }

      // Start progressive tag loading in background – don't await
      void loadRepoTags(nextClient, repoList)

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
      setUserPermissions({})
      setUserTeamPermissions({})
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

    void client
      .listTeamRepos(selectedTeam)
      .then((entries) => {
        if (cancelled) return
        setTeamPermissions((previous) => ({
          ...previous,
          [selectedTeam]: toPermissionMap(repos, entries),
        }))
      })
      .catch((error) => {
        if (cancelled) return
        setNotice({
          tone: 'error',
          title: '读取团队仓库权限失败。',
          description: formatError(error, '无法从 GitHub 获取该团队的仓库权限。'),
        })
      })

    return () => {
      cancelled = true
    }
  }, [client, repos, selectedTeam, subjectKind, teamPermissions])

  useEffect(() => {
    if (!client || subjectKind !== 'team' || !parentTeamSlug || repos.length === 0) {
      return
    }

    if (teamPermissions[parentTeamSlug]) {
      return
    }

    let cancelled = false

    void client
      .listTeamRepos(parentTeamSlug)
      .then((entries) => {
        if (cancelled) {
          return
        }

        setTeamPermissions((previous) => ({
          ...previous,
          [parentTeamSlug]: toPermissionMap(repos, entries),
        }))
      })
      .catch(() => {
        // Silently skip parent permission load failure
      })

    return () => {
      cancelled = true
    }
  }, [client, repos, parentTeamSlug, subjectKind, teamPermissions])

  useEffect(() => {
    if (!client || subjectKind !== 'user' || repos.length === 0 || !selectedUser) {
      return
    }

    // Skip if already loaded
    if (userPermissions[selectedUser]) {
      return
    }

    void loadUserPermissions(client, repos, selectedUser)
  }, [client, repos, selectedUser, subjectKind, userPermissions])

  useEffect(() => {
    setSelectedRepos(new Set())
  }, [selectedTeam, selectedUser, subjectKind])

  useEffect(() => {
    setSelectedRepos(new Set())
  }, [filterPreset, filterQuery, inheritedFilter])

  useEffect(() => {
    reposRef.current = repos
  }, [repos])

  useEffect(() => {
    teamPermissionsRef.current = teamPermissions
  }, [teamPermissions])

  useEffect(() => {
    userPermissionsRef.current = userPermissions
  }, [userPermissions])

  const processQueuedMove = async (move: QueuedMove) => {
    const previous = getSubjectPermissions(move.subject)
    const optimistic = applyOptimisticPermission(previous, move.repoNames, move.target)

    updateSubjectPermissions(move.subject, optimistic)
    addWriteOp()
    setNotice({
      tone: 'info',
      title: '正在顺序执行操作队列。',
      description: `当前处理仓库数：${move.repoNames.length}`,
    })

    try {
      const results = await executePermissionBatch(move.client, {
        subject: move.subject,
        repoNames: move.repoNames,
        target: move.target,
      })

      const settled = reconcileBatchResults(previous, optimistic, results)
      updateSubjectPermissions(move.subject, settled.next)
      setNotice(buildBatchNotice(move.target, settled.success, settled.failed))

      // Refresh access tags for successfully updated repos
      if (settled.success.length > 0) {
        refreshRepoTags(move.client, settled.success)
      }
    } catch (error) {
      updateSubjectPermissions(move.subject, previous)
      setNotice({
        tone: 'error',
        title: '操作队列执行失败。',
        description: formatError(error, '写入 GitHub 权限时出现未预期错误。'),
      })
    } finally {
      removeWriteOp()
    }
  }

  const enqueueMove = (move: QueuedMove) => {
    setNotice(buildQueueNotice(move))
    queueChainRef.current = queueChainRef.current
      .catch(() => undefined)
      .then(() => processQueuedMove(move))
  }

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

    if (repoNames.length > 1) {
      const targetLabel =
        target === 'none' ? '未授权（移除权限）' : PERMISSION_DISPLAY_LABELS[target]
      const confirmed = window.confirm(
        `即将把 ${repoNames.length} 个仓库设置到 ${targetLabel}。是否继续？`,
      )
      if (!confirmed) {
        return
      }
    }

    enqueueMove({
      client,
      subject,
      repoNames,
      target,
    })
  }

  const isBusy = connecting || refreshing

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">组织仓库权限看板</span>
          <h1>把权限调整，拖进一个看板里。</h1>
          <p>
            选择团队或协作者后，仓库按最高有效权限分列展示。支持过滤、Ctrl/Cmd 多选与批量拖拽。
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
            <span>PAT 与组织名仅存内存中，可由浏览器密码管理器保存。</span>
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
        {!hasConnectedData ? (
          <>
            <div className="section-title">
              <h2>认证与主体</h2>
            </div>

            <div className="connect-row">
              <div className="field connect-field">
                <label htmlFor="org-input">组织</label>
                <input
                  id="org-input"
                  aria-label="组织名称"
                  name="username"
                  type="text"
                  value={org}
                  autoComplete="username"
                  placeholder="your-org"
                  onChange={(event) => setOrg(event.target.value)}
                />
              </div>

              <div className="field connect-field">
                <label htmlFor="token-input">令牌</label>
                <input
                  id="token-input"
                  aria-label="个人访问令牌"
                  name="current-password"
                  type="password"
                  value={token}
                  autoComplete="current-password"
                  placeholder="ghp_xxx"
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>

              <button
                type="button"
                className="primary-button"
                disabled={connecting || writing}
                onClick={() => { void connectOrganization(false) }}
              >
                {connecting ? '连接中...' : '连接组织'}
              </button>
            </div>

            {notice ? (
              <div className={`status-banner ${notice.tone}`} role="status">
                <strong>{notice.title}</strong>
                {notice.description ? <span>{notice.description}</span> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="connected-bar">
              <span className="org-label">{org}</span>

              <div className="field inline-field">
                <select
                  id="subject-kind"
                  aria-label="主体类型"
                  value={subjectKind}
                  onChange={(event) => setSubjectKind(event.target.value as SubjectKind)}
                >
                  <option value="team">团队</option>
                  <option value="user">个人协作者</option>
                </select>
              </div>

              {subjectKind === 'team' ? (
                <div className="field inline-field">
                  <select
                    id="team-select"
                    aria-label="团队选择"
                    value={selectedTeam}
                    onChange={(event) => setSelectedTeam(event.target.value)}
                  >
                    {teamOptions.length === 0 ? (
                      <option value="">无团队</option>
                    ) : null}
                    {teamOptions.map((option) => (
                      <option key={option.team.id} value={option.team.slug}>
                        {formatTeamOption(option)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field inline-field">
                  <select
                    id="user-select"
                    aria-label="个人协作者"
                    value={selectedUser}
                    onChange={(event) => setSelectedUser(event.target.value)}
                  >
                    {users.length === 0 ? (
                      <option value="">无成员</option>
                    ) : null}
                    {users.map((user) => (
                      <option key={user.login} value={user.login}>
                        {user.login}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <span className="stat-badge">仓库 {repos.length}</span>
              <span className="stat-badge">团队 {teamOptions.length}</span>
              <span className="stat-badge">成员 {users.length}</span>

              <div className="connected-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={refreshing || writing}
                  onClick={() => { void connectOrganization(true) }}
                >
                  {refreshing ? '刷新中...' : '刷新'}
                </button>

                {isAdmin === false ? (
                  <span className="readonly-tip">无管理员权限</span>
                ) : null}
              </div>
            </div>

            {notice ? (
              <div className={`status-banner ${notice.tone}`} role="status">
                <strong>{notice.title}</strong>
                {notice.description ? <span>{notice.description}</span> : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="board-panel">
        {hasConnectedData ? (
          <>
            <div className="board-toolbar">
              <h2>权限看板</h2>
              <div className="toolbar-right">
                <div className="toolbar-main">
                <div className="field toolbar-search">
                  <div className="search-box">
                    <input
                      id="repo-filter"
                      aria-label="按名称、topic 或团队/成员过滤"
                      type="text"
                      value={filterQuery}
                      placeholder="搜索名称、topic、团队或成员..."
                      onChange={(event) => setFilterQuery(event.target.value)}
                    />
                    {filterQuery ? (
                      <button
                        type="button"
                        className="search-clear"
                        onClick={() => setFilterQuery('')}
                        aria-label="清空过滤"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="preset-filter-group" aria-label="仓库预置过滤">
                  {REPO_FILTER_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className={`filter-icon-btn ${filterPreset === preset.key ? 'active' : ''}`}
                      title={preset.label}
                      aria-label={preset.label}
                      onClick={() => setFilterPreset(preset.key)}
                    >
                      {preset.icon} {preset.label}
                    </button>
                  ))}
                </div>

                {(subjectKind === 'team' && parentTeamSlug) || (subjectKind === 'user' && selectedUser) ? (
                  <div className="preset-filter-group" aria-label="继承权限过滤">
                    {INHERITED_FILTER_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        className={`filter-icon-btn ${inheritedFilter === preset.key ? 'active' : ''}`}
                        title={preset.label}                      aria-label={preset.label}                        onClick={() => setInheritedFilter(preset.key)}
                      >
                        {preset.icon} {preset.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="toolbar-side">
                <span className="badge">已选卡片：{selectedRepos.size}</span>
                <span className={`badge ops-badge${activeOps.reads > 0 || activeOps.writes > 0 ? ' busy' : ''}`}>
                  操作状态：{activeOps.reads === 0 && activeOps.writes === 0
                    ? '空闲'
                    : [
                        activeOps.reads > 0 ? `读取 ${activeOps.reads}` : '',
                        activeOps.writes > 0 ? `写入 ${activeOps.writes}` : '',
                      ].filter(Boolean).join(' ')
                  }
                </span>
              </div>
              </div>
            </div>

            <PermissionBoard
              repos={repoCards}
              permissionByRepo={currentPermissionMap}
              filterQuery={filterQuery}
              filterPreset={filterPreset}
              inheritedFilter={inheritedFilter}
              parentPermissionByRepo={currentParentPermissionMap}
              selectedRepos={selectedRepos}
              interactive={isAdmin === true && !isBusy}
              onToggleSelect={(repoName, additive) => {
                setSelectedRepos((previous) => toggleSelection(previous, repoName, additive))
              }}
              onMoveRequested={(repoNames, target) => {
                void handleMoveRequested(repoNames, target)
              }}
            />
          </>
        ) : (
          <div className="empty-state">
            <strong>先完成组织连接，再拖拽管理权限。</strong>
            <span>仅组织管理员令牌可用。</span>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
