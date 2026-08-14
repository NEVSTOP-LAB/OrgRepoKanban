export type PageId = 'home' | 'permissions' | 'secrets' | 'runners'

export interface HomeNotice {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
}

export interface HomePageProps {
  token: string
  org: string
  connecting: boolean
  connected: boolean
  notice: HomeNotice | null
  onTokenChange: (value: string) => void
  onOrgChange: (value: string) => void
  onConnect: () => void
  onDisconnect: () => void
  onNavigate: (page: PageId) => void
}

const NAV_CARDS: Array<{
  page: Exclude<PageId, 'home'>
  icon: string
  title: string
  description: string
  tags: Array<{ label: string; className: string }>
}> = [
  {
    page: 'permissions',
    icon: '📋',
    title: '权限看板',
    description: '按团队或协作者维度查看仓库权限分布，支持 Ctrl/Cmd 多选与批量拖拽调整。',
    tags: [
      { label: 'Read → Admin', className: 'repo-tag is-public' },
      { label: '拖拽操作', className: 'repo-tag is-topic' },
      { label: '团队维度', className: 'repo-tag is-access team' },
    ],
  },
  {
    page: 'secrets',
    icon: '🔐',
    title: 'Secret 管理',
    description: '查看组织级 Secret，通过拖拽为私有仓库批量配置 Actions 密钥。',
    tags: [
      { label: '私有仓库', className: 'repo-tag is-private' },
      { label: '拖拽操作', className: 'repo-tag is-topic' },
      { label: '手动输入值', className: 'repo-tag is-access user' },
    ],
  },
  {
    page: 'runners',
    icon: '🏃',
    title: 'Runner 看板',
    description: '查看组织自托管 Runner 的在线与忙碌状态，追踪排队等待执行的 workflow。',
    tags: [
      { label: '只读监控', className: 'repo-tag is-public' },
      { label: '排队队列', className: 'repo-tag is-topic' },
      { label: '自动刷新', className: 'repo-tag is-access team' },
    ],
  },
]

export function HomePage({
  token,
  org,
  connecting,
  connected,
  notice,
  onTokenChange,
  onOrgChange,
  onConnect,
  onDisconnect,
  onNavigate,
}: HomePageProps) {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">NEVSTOP-LAB 组织管理</span>
          <h1>组织仓库治理工具集</h1>
          <p>
            统一认证，一处连接：权限看板、Secret 配置与 Actions Runner 监控共享同一次登录。
          </p>
          <div className="badge-row">
            <span className="badge">权限看板：拖拽式批量权限调整</span>
            <span className="badge">Secret 管理：私有仓库密钥配置</span>
            <span className="badge">Runner 看板：运行与排队监控</span>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <strong>凭据安全</strong>
            <span>PAT 仅存内存，关闭页面即销毁；断开连接立即清除。</span>
          </div>
          <div className="meta-card">
            <strong>令牌权限</strong>
            <span>需要 admin:org 与 repo；查看 Runner 另需 manage_runners:org。</span>
          </div>
          <div className="meta-card">
            <strong>Secret 加密</strong>
            <span>使用 libsodium 密封盒加密后传输，不会以明文存储在网络中。</span>
          </div>
        </div>
      </section>

      <section className="control-panel">
        {!connected ? (
          <div className="connect-row">
            <div className="field connect-field">
              <label htmlFor="home-pat-input">个人访问令牌（PAT）</label>
              <input
                id="home-pat-input"
                type="password"
                value={token}
                placeholder="ghp_..."
                autoComplete="current-password"
                onChange={(event) => onTokenChange(event.target.value)}
              />
            </div>
            <div className="field connect-field">
              <label htmlFor="home-org-input">组织名称</label>
              <input
                id="home-org-input"
                type="text"
                value={org}
                placeholder="例如 nevstop-lab"
                onChange={(event) => onOrgChange(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={connecting}
              onClick={onConnect}
            >
              {connecting ? '连接中…' : '连接组织'}
            </button>
          </div>
        ) : (
          <div className="connected-bar">
            <span className="org-label">{org.trim()}</span>
            <span className="stat-badge">已通过组织管理员校验</span>
            <div className="connected-actions">
              <button type="button" className="ghost-button" onClick={onDisconnect}>
                断开连接
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className={`status-banner ${notice.tone}`} role="status">
            <strong>{notice.title}</strong>
            {notice.description && <span>{notice.description}</span>}
          </div>
        )}
      </section>

      <section className="control-panel home-nav-panel">
        <div className="section-title">
          <h2>选择功能模块</h2>
          <p>
            {connected
              ? '连接有效期内可自由切换各看板，无需重复输入凭据。'
              : '三个看板共享同一组织连接，请先在上方完成认证。'}
          </p>
        </div>

        <div className="home-nav-grid">
          {NAV_CARDS.map((card) => (
            <button
              key={card.page}
              type="button"
              className="home-nav-card"
              disabled={!connected}
              onClick={() => onNavigate(card.page)}
            >
              <span className="home-nav-icon">{card.icon}</span>
              <div className="home-nav-body">
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <span className="home-nav-tags">
                  {card.tags.map((tag) => (
                    <span key={tag.label} className={tag.className}>
                      {tag.label}
                    </span>
                  ))}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}