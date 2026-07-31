import { useState } from 'react'

import App from './App'
import { HomePage, type PageId } from './components/HomePage'
import { SecretManager } from './components/SecretManager'

/**
 * Root router component.
 *
 * Manages page-level navigation between:
 *  - home        → HomePage (landing / nav)
 *  - permissions → App (existing Permission Kanban)
 *  - secrets     → SecretManager (new Secret management)
 *
 * The existing App component is rendered unchanged when permissions is active.
 * A thin back-navigation bar is rendered above it so users can return home.
 */
export function Root() {
  const [page, setPage] = useState<PageId>('home')

  if (page === 'home') {
    return <HomePage onNavigate={setPage} />
  }

  if (page === 'secrets') {
    return <SecretManager onBack={() => setPage('home')} />
  }

  // permissions — wrap the existing App unchanged
  return (
    <>
      <div style={{ padding: '16px 24px 0' }}>
        <button
          type="button"
          className="back-nav-button"
          onClick={() => setPage('home')}
        >
          ← 返回首页
        </button>
      </div>
      <App />
    </>
  )
}
