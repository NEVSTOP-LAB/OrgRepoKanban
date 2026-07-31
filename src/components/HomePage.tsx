export type PageId = 'home' | 'permissions' | 'secrets'

export interface HomePageProps {
  onNavigate: (page: PageId) => void
}

export function HomePage({ onNavigate }: HomePageProps) {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">NEVSTOP-LAB 组织管理</span>
          <h1>组织仓库治理工具集</h1>
          <p>
            统一的 GitHub 组织管理入口：权限看板与 Secret 配置一站完成。
          </p>
          <div className="badge-row">
            <span className="badge">权限看板：拖拽式批量权限调整</span>
            <span className="badge">Secret 管理：私有仓库密钥配置</span>
            <span className="badge">仅需组织管理员 PAT 令牌</span>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <strong>凭据安全</strong>
            <span>PAT 仅存内存，关闭页面即销毁；所有操作通过 GitHub 官方 API 执行。</span>
          </div>
          <div className="meta-card">
            <strong>令牌权限</strong>
            <span>需要 admin:org 与 repo 权限的组织管理员令牌。</span>
          </div>
          <div className="meta-card">
            <strong>Secret 加密</strong>
            <span>使用 libsodium 密封盒加密后传输，不会以明文存储在网络中。</span>
          </div>
        </div>
      </section>

      <section className="control-panel home-nav-panel">
        <div className="section-title">
          <h2>选择功能模块</h2>
          <p>点击卡片进入对应的管理工具。</p>
        </div>

        <div className="home-nav-grid">
          <button
            type="button"
            className="home-nav-card"
            onClick={() => onNavigate('permissions')}
          >
            <span className="home-nav-icon">📋</span>
            <div className="home-nav-body">
              <h3>权限看板</h3>
              <p>按团队或协作者维度查看仓库权限分布，支持 Ctrl/Cmd 多选与批量拖拽调整。</p>
              <span className="home-nav-tags">
                <span className="repo-tag is-public">Read → Admin</span>
                <span className="repo-tag is-topic">拖拽操作</span>
                <span className="repo-tag is-access team">团队维度</span>
              </span>
            </div>
          </button>

          <button
            type="button"
            className="home-nav-card"
            onClick={() => onNavigate('secrets')}
          >
            <span className="home-nav-icon">🔐</span>
            <div className="home-nav-body">
              <h3>Secret 管理</h3>
              <p>查看组织级 Secret，通过拖拽为私有仓库批量配置 Actions 密钥。</p>
              <span className="home-nav-tags">
                <span className="repo-tag is-private">私有仓库</span>
                <span className="repo-tag is-topic">拖拽操作</span>
                <span className="repo-tag is-access user">手动输入值</span>
              </span>
            </div>
          </button>
        </div>
      </section>
    </main>
  )
}
