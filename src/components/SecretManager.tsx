import { useState } from 'react'

import { GithubClient } from '../github/client'
import type { GithubRepo } from '../github/data'
import {
  addPendingOp,
  effectiveRepoSecrets,
  formatPendingOp,
  type OrgSecret,
  type PendingSecretOp,
  type RepoSecretInfo,
  type SecretSummary,
} from '../domain/secret'

// ── Types ───────────────────────────────────────────────────────────────────

interface Notice {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
}

interface RepoSecretState {
  repo: GithubRepo
  secrets: RepoSecretInfo[]
}

interface DragPayload {
  kind: 'secret'
  secretName: string
}

function parseDragPayload(dataTransfer: DataTransfer): DragPayload | null {
  try {
    const raw = dataTransfer.getData('application/json')
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DragPayload>
    if (parsed.kind === 'secret' && typeof parsed.secretName === 'string') {
      return parsed as DragPayload
    }
    return null
  } catch {
    return null
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export interface SecretManagerProps {
  onBack: () => void
}

export function SecretManager({ onBack }: SecretManagerProps) {
  // Connection state
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('')
  const [client, setClient] = useState<GithubClient | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Data state
  const [orgSecrets, setOrgSecrets] = useState<OrgSecret[]>([])
  const [repoStates, setRepoStates] = useState<RepoSecretState[]>([])
  const [loading, setLoading] = useState(false)

  // User-supplied secret values (name → value)
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})

  // Pending operations
  const [pendingOps, setPendingOps] = useState<PendingSecretOp[]>([])
  const [executing, setExecuting] = useState(false)

  // Drag highlight state
  const [dragOverRepo, setDragOverRepo] = useState<string | null>(null)
  const [dragOverSecret, setDragOverSecret] = useState<string | null>(null)

  // Safari-compatible DataTransfer type check (DOMStringList lacks .includes)
  const hasDragType = (dt: DataTransfer, type: string): boolean =>
    Array.from(dt.types).includes(type)


  // ── Helpers ───────────────────────────────────────────────────────────

  const updateSecretValue = (name: string, value: string) => {
    setSecretValues((prev) => ({ ...prev, [name]: value }))
  }

  const getSecretValue = (name: string): string => secretValues[name] ?? ''

  const getRepoConfiguredSecrets = (repoName: string): string[] => {
    const state = repoStates.find((r) => r.repo.name === repoName)
    return state?.secrets.map((s) => s.name) ?? []
  }

  const clearNotice = () => setNotice(null)

  // ── Connection ────────────────────────────────────────────────────────

  const connectOrg = async () => {
    const trimmedToken = token.trim()
    const trimmedOrg = org.trim()

    if (!trimmedToken || !trimmedOrg) {
      setNotice({ tone: 'warning', title: '请先填写个人访问令牌和组织名称。' })
      return
    }

    clearNotice()
    setConnecting(true)

    const nextClient = new GithubClient(trimmedToken, trimmedOrg)

    try {
      const admin = await nextClient.verifyOrgAdmin()
      setIsAdmin(admin)

      if (!admin) {
        setClient(null)
        setNotice({
          tone: 'warning',
          title: '当前令牌不是该组织管理员，无法管理 Secret。',
          description: '请使用具备 admin:org 和 repo 权限的组织管理员令牌。',
        })
        return
      }

      setClient(nextClient)
      await loadData(nextClient)
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '连接组织失败。',
        description: error instanceof Error ? error.message : '未知错误',
      })
    } finally {
      setConnecting(false)
    }
  }

  const loadData = async (activeClient: GithubClient) => {
    setLoading(true)
    clearNotice()

    try {
      // Load org secrets and repos in parallel
      const [secrets, repos] = await Promise.all([
        activeClient.listOrgSecrets(),
        activeClient.listOrgRepos(),
      ])

      setOrgSecrets(secrets)

      // Filter to private repos only
      const privateRepos = repos.filter((r) => Boolean(r.private))

      // Load repo secrets for each private repo (with concurrency)
      const CONCURRENCY = 6
      const queue = [...privateRepos]
      const results: RepoSecretState[] = []

      const worker = async () => {
        while (queue.length > 0) {
          const repo = queue.shift()!
          try {
            const repoSecrets = await activeClient.listRepoSecrets(repo.name)
            results.push({ repo, secrets: repoSecrets })
          } catch {
            results.push({ repo, secrets: [] })
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, privateRepos.length) }, () => worker()),
      )

      // Sort: repos with secrets first
      results.sort((a, b) => {
        const aCount = a.secrets.length
        const bCount = b.secrets.length
        if (aCount !== bCount) return bCount - aCount
        return a.repo.name.localeCompare(b.repo.name)
      })

      setRepoStates(results)
      setNotice({
        tone: 'info',
        title: `已加载 ${secrets.length} 个组织 Secret 和 ${privateRepos.length} 个私有仓库。`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '加载数据失败。',
        description: error instanceof Error ? error.message : '未知错误',
      })
    } finally {
      setLoading(false)
    }
  }

  // ── Secret value management ───────────────────────────────────────────

  const handleRemoveSecretValue = (secretName: string) => {
    setSecretValues((prev) => {
      const next = { ...prev }
      delete next[secretName]
      return next
    })

    // Also remove any pending ops that reference this secret
    setPendingOps((prev) =>
      prev.filter((op) => op.secretName !== secretName),
    )
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────

  const onSecretDragStart = (event: React.DragEvent, secretName: string) => {
    const value = getSecretValue(secretName)
    if (!value) {
      event.preventDefault()
      return
    }

    const payload: DragPayload = { kind: 'secret', secretName }
    event.dataTransfer.setData('application/json', JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'link'
  }

  // Drop a secret onto a repo → set secret on repo
  const onRepoDrop = (event: React.DragEvent, repoName: string) => {
    event.preventDefault()
    setDragOverRepo(null)

    const payload = parseDragPayload(event.dataTransfer)
    if (!payload || payload.kind !== 'secret') return

    const value = getSecretValue(payload.secretName)
    if (!value) {
      setNotice({ tone: 'warning', title: `请先为 Secret「${payload.secretName}」输入值再拖拽。` })
      return
    }

    const configured = getRepoConfiguredSecrets(repoName)

    setPendingOps((prev) =>
      addPendingOp(prev, repoName, payload.secretName, value, configured),
    )
  }

  // Drop a repo (dragged from right panel) onto a secret → set secret on repo
  const onSecretDrop = (event: React.DragEvent, secretName: string) => {
    event.preventDefault()
    setDragOverSecret(null)

    // Repo drag uses a custom type; validate against known repos
    const repoName = event.dataTransfer.getData('application/x-repo-name')
    if (!repoName) return

    // Validate repoName is a known private repo
    if (!repoStates.some((rs) => rs.repo.name === repoName)) return

    const value = getSecretValue(secretName)
    if (!value) {
      setNotice({ tone: 'warning', title: `请先为 Secret「${secretName}」输入值再接受仓库拖拽。` })
      return
    }

    const configured = getRepoConfiguredSecrets(repoName)

    setPendingOps((prev) =>
      addPendingOp(prev, repoName, secretName, value, configured),
    )
  }

  // Repo card drag start
  const onRepoDragStart = (event: React.DragEvent, repoName: string) => {
    event.dataTransfer.setData('application/x-repo-name', repoName)
    event.dataTransfer.effectAllowed = 'link'
  }

  // ── Pending operations ────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (pendingOps.length === 0) return
    if (!client) return

    setExecuting(true)
    setNotice({ tone: 'info', title: '正在执行 Secret 操作...' })

    const succeededDescs: string[] = []
    const failed: Array<{ desc: string; error: string }> = []
    const succeededIndices = new Set<number>()

    for (let i = 0; i < pendingOps.length; i++) {
      const op = pendingOps[i]
      try {
        if (op.action === 'set') {
          await client.setRepoSecret(op.repoName, op.secretName, op.value)
        } else {
          await client.deleteRepoSecret(op.repoName, op.secretName)
        }
        succeededDescs.push(formatPendingOp(op))
        succeededIndices.add(i)
      } catch (error) {
        failed.push({
          desc: formatPendingOp(op),
          error: error instanceof Error ? error.message : '未知错误',
        })
      }
    }

    // Refresh repo secrets for affected repos
    const affectedRepos = new Set(pendingOps.map((op) => op.repoName))
    for (const repoName of affectedRepos) {
      try {
        const repoSecrets = await client.listRepoSecrets(repoName)
        setRepoStates((prev) =>
          prev.map((rs) =>
            rs.repo.name === repoName ? { ...rs, secrets: repoSecrets } : rs,
          ),
        )
      } catch {
        // keep stale data on refresh failure
      }
    }

    // Keep failed ops in the queue for retry; only remove succeeded ones
    if (succeededIndices.size > 0) {
      setPendingOps((prev) => prev.filter((_, i) => !succeededIndices.has(i)))
    }

    // Only clear a secret's value when ALL set ops for that name succeeded
    // (if any op for secret X failed, keep the value so the user can retry)
    if (succeededIndices.size > 0) {
      // Collect secret names that had any failed op
      const failedSecretNames = new Set<string>()
      for (let i = 0; i < pendingOps.length; i++) {
        if (!succeededIndices.has(i)) {
          failedSecretNames.add(pendingOps[i].secretName)
        }
      }

      const safeToClear = new Set<string>()
      for (const i of succeededIndices) {
        const op = pendingOps[i]
        if (op.action === 'set' && !failedSecretNames.has(op.secretName)) {
          safeToClear.add(op.secretName)
        }
      }

      if (safeToClear.size > 0) {
        setSecretValues((prev) => {
          const next = { ...prev }
          for (const name of safeToClear) {
            delete next[name]
          }
          return next
        })
      }
    }

    if (failed.length === 0) {
      setNotice({
        tone: 'success',
        title: `全部 ${succeededDescs.length} 个 Secret 操作已完成。`,
        description: succeededDescs.join('；'),
      })
    } else {
      setNotice({
        tone: 'warning',
        title: `部分完成：成功 ${succeededDescs.length} 个，失败 ${failed.length} 个。`,
        description: [
          ...succeededDescs.map((s) => `✓ ${s}`),
          ...failed.map((f) => `✗ ${f.desc}: ${f.error}`),
        ].join('\n'),
      })
    }

    setExecuting(false)
  }

  const handleCancel = () => {
    setPendingOps([])
    setNotice({ tone: 'info', title: '已取消所有待执行操作。' })
  }

  const handleRemoveOp = (index: number) => {
    setPendingOps((prev) => prev.filter((_, i) => i !== index))
  }

  // Queue a delete operation for a secret on a repo (click × on tag)
  const handleQueueDelete = (repoName: string, secretName: string) => {
    const configured = getRepoConfiguredSecrets(repoName)
    setPendingOps((prev) =>
      addPendingOp(prev, repoName, secretName, '', configured),
    )
  }

  // ── Render helpers ────────────────────────────────────────────────────

  const hasData = client !== null && isAdmin === true && repoStates.length > 0
  const isBusy = connecting || loading || executing

  // Prepare repo summaries for the right panel
  const repoSummaries = repoStates.map((rs) => ({
    name: rs.repo.name,
    fullName: rs.repo.full_name,
    url: rs.repo.html_url,
    configuredSecrets: effectiveRepoSecrets(
      rs.secrets.map((s) => s.name),
      pendingOps,
      rs.repo.name,
    ),
  }))

  // Prepare secret summaries for the left panel
  const secretSummaries: SecretSummary[] = orgSecrets.map((s) => ({
    name: s.name,
    userValue: getSecretValue(s.name),
  }))

  return (
    <main className="app-shell">
      {/* Hero */}
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="back-nav">
            <button type="button" className="back-nav-button" onClick={onBack}>
              ← 返回首页
            </button>
          </div>
          <span className="eyebrow">组织 Secret 管理</span>
          <h1>为私有仓库配置 Actions 密钥</h1>
          <p>
            左侧查看组织 Secret 并手动填入值，拖拽至右侧私有仓库即可批量配置。
          </p>
          <div className="badge-row">
            <span className="badge">拖拽 Secret 到仓库或仓库到 Secret</span>
            <span className="badge">下方确认后通过加密通道写入 GitHub</span>
            <span className="badge">值使用 libsodium 密封盒加密传输</span>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <strong>操作流程</strong>
            <span>连接组织 → 填入 Secret 值 → 拖拽匹配 → 确认执行。</span>
          </div>
          <div className="meta-card">
            <strong>安全说明</strong>
            <span>Secret 值仅在浏览器内存中暂存，写入后即丢弃。</span>
          </div>
          <div className="meta-card">
            <strong>支持的 Secret</strong>
            <span>目前仅支持仓库级 Actions Secret（org 级通过 API 策略控制）。</span>
          </div>
        </div>
      </section>

      {/* Connection / Toolbar */}
      <section className="control-panel">
        {!hasData ? (
          <>
            <div className="section-title">
              <h2>连接组织</h2>
            </div>

            <div className="connect-row">
              <div className="field connect-field">
                <label htmlFor="secret-org-input">组织</label>
                <input
                  id="secret-org-input"
                  aria-label="组织名称"
                  name="username"
                  type="text"
                  value={org}
                  autoComplete="username"
                  placeholder="your-org"
                  onChange={(e) => setOrg(e.target.value)}
                />
              </div>

              <div className="field connect-field">
                <label htmlFor="secret-token-input">令牌</label>
                <input
                  id="secret-token-input"
                  aria-label="个人访问令牌"
                  name="current-password"
                  type="password"
                  value={token}
                  autoComplete="current-password"
                  placeholder="ghp_xxx"
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="primary-button"
                disabled={connecting}
                onClick={() => { void connectOrg() }}
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
          <div className="connected-bar">
            <span className="org-label">{org}</span>
            <span className="stat-badge">
              Secret {orgSecrets.length}
            </span>
            <span className="stat-badge">
              私有仓库 {repoStates.length}
            </span>
            <span className="stat-badge">
              待执行 {pendingOps.length}
            </span>

            <div className="connected-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={loading || executing}
                onClick={() => {
                  if (client) {
                    setPendingOps([])
                    void loadData(client)
                  }
                }}
              >
                {loading ? '刷新中...' : '刷新'}
              </button>
            </div>
          </div>
        )}

        {notice && hasData ? (
          <div className={`status-banner ${notice.tone}`} role="status">
            <strong>{notice.title}</strong>
            {notice.description ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{notice.description}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Two-column drag area */}
      {hasData ? (
        <section className="secret-board-panel">
          {/* ── Left: Org Secrets ───────────────────────────────────── */}
          <div className="secret-column secret-left">
            <div className="secret-column-header">
              <h3>🔐 组织 Secret</h3>
              <span>{secretSummaries.length}</span>
            </div>
            <div
              className="secret-column-body"
              onDragOver={(e) => {
                // Only accept repo→secret drops
                if (hasDragType(e.dataTransfer, 'application/x-repo-name')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'link'
                }
              }}
            >
              {secretSummaries.length === 0 ? (
                <div className="secret-empty">该组织暂无 Actions Secret</div>
              ) : null}
              {secretSummaries.map((secret) => (
                <div
                  key={secret.name}
                  className={`secret-card${dragOverSecret === secret.name ? ' drag-over' : ''}`}
                  draggable={!isBusy && secret.userValue.length > 0}
                  onDragStart={(e) => onSecretDragStart(e, secret.name)}
                  onDragOver={(e) => {
                    // Only accept repo→secret drops
                    if (hasDragType(e.dataTransfer, 'application/x-repo-name')) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'link'
                      setDragOverSecret(secret.name)
                    }
                  }}
                  onDragLeave={() => setDragOverSecret(null)}
                  onDrop={(e) => onSecretDrop(e, secret.name)}
                >
                  <div className="secret-card-info">
                    <span className="secret-card-name">{secret.name}</span>
                    <div className="secret-value-row">
                      <input
                        type="password"
                        className="secret-value-input"
                        placeholder="输入 Secret 值..."
                        value={secret.userValue}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          updateSecretValue(secret.name, e.target.value)
                        }
                        aria-label={`${secret.name} 的值`}
                      />
                      {secret.userValue ? (
                        <button
                          type="button"
                          className="secret-value-clear"
                          title="清除已输入的值"
                          aria-label="清除值"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveSecretValue(secret.name)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <span className="secret-card-hint">
                      {secret.userValue
                        ? '✓ 已填入 · 可拖拽到仓库'
                        : '请输入值后才能拖拽'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: Private Repos ────────────────────────────────── */}
          <div className="secret-column secret-right">
            <div className="secret-column-header">
              <h3>🔒 私有仓库</h3>
              <span>{repoSummaries.length}</span>
            </div>
            <div className="secret-column-body">
              {repoSummaries.length === 0 ? (
                <div className="secret-empty">该组织暂无私有仓库</div>
              ) : null}
              {repoSummaries.map((repo) => (
                <div
                  key={repo.name}
                  className={`repo-secret-card${dragOverRepo === repo.name ? ' drag-over' : ''}`}
                  draggable={!isBusy}
                  onDragStart={(e) => onRepoDragStart(e, repo.name)}
                  onDragOver={(e) => {
                    // Only accept secret→repo drops
                    if (hasDragType(e.dataTransfer, 'application/json')) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'link'
                      setDragOverRepo(repo.name)
                    }
                  }}
                  onDragLeave={() => setDragOverRepo(null)}
                  onDrop={(e) => onRepoDrop(e, repo.name)}
                >
                  <div className="repo-card-info">
                    <a
                      className="repo-card-name"
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.stopPropagation()}
                    >
                      {repo.name}
                    </a>
                    <span className="repo-card-tags">
                      {repo.configuredSecrets.length === 0 ? (
                        <span className="repo-tag is-private">无 Secret</span>
                      ) : null}
                      {repo.configuredSecrets.map((s) => (
                        <span key={s} className="repo-tag is-topic repo-tag-secret">
                          🔑 {s}
                          <button
                            type="button"
                            className="repo-tag-remove"
                            title={`从 ${repo.name} 移除 ${s}`}
                            aria-label={`移除 ${s}`}
                            disabled={isBusy}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleQueueDelete(repo.name, s)
                            }}
                            onDragStart={(e) => e.stopPropagation()}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="board-panel">
          <div className="empty-state">
            <strong>先连接组织，再管理 Secret。</strong>
            <span>仅组织管理员令牌可用。</span>
          </div>
        </section>
      )}

      {/* ── Bottom: Pending Operations ──────────────────────────────── */}
      {hasData && (
        <section className="control-panel pending-panel">
          <div className="section-title">
            <h2>待执行操作</h2>
            <p>
              {pendingOps.length === 0
                ? '暂无待执行操作。请拖拽 Secret 卡片到仓库卡片（或反向拖拽）来创建操作。'
                : `共 ${pendingOps.length} 个操作待确认执行。`}
            </p>
          </div>

          {pendingOps.length > 0 ? (
            <>
              <ul className="pending-ops-list">
                {pendingOps.map((op, index) => (
                  <li key={`${op.repoName}-${op.secretName}-${index}`} className="pending-op-item">
                    <span className="pending-op-desc">
                      {formatPendingOp(op)}
                    </span>
                    <button
                      type="button"
                      className="pending-op-remove"
                      title="移除此操作"
                      aria-label="移除此操作"
                      disabled={executing}
                      onClick={() => handleRemoveOp(index)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              <div className="pending-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={executing || pendingOps.length === 0}
                  onClick={() => { void handleConfirm() }}
                >
                  {executing ? '执行中...' : `确认执行 (${pendingOps.length})`}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={executing}
                  onClick={handleCancel}
                >
                  取消全部
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </main>
  )
}
