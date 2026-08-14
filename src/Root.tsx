import { useState } from 'react'

import App from './App'
import { HomePage, type HomeNotice, type PageId } from './components/HomePage'
import { RunnerBoard } from './components/RunnerBoard'
import { SecretManager } from './components/SecretManager'
import { GithubClient } from './github/client'

/**
 * Root router component.
 *
 * Owns the shared authentication state (PAT + org name + GithubClient).
 * The connection form lives on the home page; all feature pages receive the
 * connected client as props and never ask for credentials themselves.
 */
export function Root() {
  const [page, setPage] = useState<PageId>('home')
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('')
  const [client, setClient] = useState<GithubClient | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState<HomeNotice | null>(null)

  const connectOrg = async () => {
    const trimmedToken = token.trim()
    const trimmedOrg = org.trim()

    if (!trimmedToken || !trimmedOrg) {
      setNotice({ tone: 'warning', title: '请先填写个人访问令牌和组织名称。' })
      return
    }

    setNotice(null)
    setConnecting(true)

    try {
      const nextClient = new GithubClient(trimmedToken, trimmedOrg)
      const admin = await nextClient.verifyOrgAdmin()

      if (!admin) {
        setClient(null)
        setNotice({
          tone: 'warning',
          title: '当前令牌不是该组织管理员。',
          description: '请使用具备 admin:org 与 repo 权限的组织管理员令牌重新连接。',
        })
        return
      }

      setClient(nextClient)
      setNotice({
        tone: 'success',
        title: `已连接组织 ${trimmedOrg}`,
        description: '令牌与组织名仅存内存，刷新页面后即失效；三个看板共享本次连接。',
      })
    } catch (error) {
      setClient(null)
      setNotice({
        tone: 'error',
        title: '连接组织失败。',
        description:
          error instanceof Error && error.message
            ? error.message
            : '请检查令牌权限、组织名称或网络连接。',
      })
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = () => {
    setClient(null)
    setToken('')
    setNotice(null)
    setPage('home')
  }

  const homePage = (
    <HomePage
      token={token}
      org={org}
      connecting={connecting}
      connected={client !== null}
      notice={notice}
      onTokenChange={setToken}
      onOrgChange={setOrg}
      onConnect={() => void connectOrg()}
      onDisconnect={disconnect}
      onNavigate={setPage}
    />
  )

  if (page === 'home' || !client) {
    return homePage
  }

  if (page === 'secrets') {
    return <SecretManager client={client} org={org} onBack={() => setPage('home')} />
  }

  if (page === 'runners') {
    return <RunnerBoard client={client} org={org} onBack={() => setPage('home')} />
  }

  // permissions — wrap the existing App with a back-navigation bar
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
      <App client={client} org={org} />
    </>
  )
}