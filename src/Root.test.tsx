import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Root } from './Root'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function stubAdminVerify() {
  fetchMock.mockImplementation((input) => {
    const url = String(input)
    if (url.includes('/user/memberships/orgs/acme')) {
      return Promise.resolve(jsonResponse({ role: 'admin' }))
    }
    if (url.includes('/orgs/acme/repos')) {
      return Promise.resolve(jsonResponse([]))
    }
    if (url.includes('/orgs/acme/teams?')) {
      return Promise.resolve(jsonResponse([]))
    }
    if (url.includes('/orgs/acme/members')) {
      return Promise.resolve(jsonResponse([]))
    }
    throw new Error(`unexpected request: ${url}`)
  })
}

async function connect() {
  fireEvent.change(screen.getByLabelText('个人访问令牌（PAT）'), {
    target: { value: 'token-value' },
  })
  fireEvent.change(screen.getByLabelText('组织名称'), {
    target: { value: 'acme' },
  })
  fireEvent.click(screen.getByRole('button', { name: '连接组织' }))
}

describe('Root', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('keeps board cards locked before connecting', () => {
    render(<Root />)
    expect(screen.getByRole('button', { name: /权限看板/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Secret 管理/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Runner 看板/ })).toBeDisabled()
    expect(screen.getByText('三个看板共享同一组织连接，请先在上方完成认证。')).toBeInTheDocument()
  })

  it('connects with an admin token and unlocks board cards', async () => {
    stubAdminVerify()
    render(<Root />)
    await connect()

    await waitFor(() =>
      expect(screen.getByText('已通过组织管理员校验')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /权限看板/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Secret 管理/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Runner 看板/ })).toBeEnabled()
    expect(screen.getByText('已连接组织 acme')).toBeInTheDocument()
  })

  it('warns when the token is not an org admin', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/user/memberships/orgs/acme')) {
        return Promise.resolve(jsonResponse({ role: 'member' }))
      }
      throw new Error(`unexpected request: ${url}`)
    })

    render(<Root />)
    await connect()

    await waitFor(() =>
      expect(screen.getByText('当前令牌不是该组织管理员。')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /权限看板/ })).toBeDisabled()
    expect(screen.queryByText('断开连接')).not.toBeInTheDocument()
  })

  it('disconnect clears credentials and locks the boards again', async () => {
    stubAdminVerify()
    render(<Root />)
    await connect()
    await waitFor(() => expect(screen.getByText('断开连接')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))

    expect(screen.getByRole('button', { name: '连接组织' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /权限看板/ })).toBeDisabled()
    expect(screen.getByLabelText('个人访问令牌（PAT）')).toHaveValue('')
  })

  it('enters the permission board with the shared connection', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/user/memberships/orgs/acme')) {
        return Promise.resolve(jsonResponse({ role: 'admin' }))
      }
      if (url.includes('/orgs/acme/repos')) {
        return Promise.resolve(
          jsonResponse([{ id: 1, name: 'repo-a', full_name: 'acme/repo-a', private: true, fork: false }]),
        )
      }
      if (url.includes('/orgs/acme/teams?')) {
        return Promise.resolve(
          jsonResponse([{ id: 10, slug: 'platform', name: 'Platform', parent: null }]),
        )
      }
      if (url.includes('/orgs/acme/members')) {
        return Promise.resolve(jsonResponse([{ login: 'alice', id: 100 }]))
      }
      if (url.includes('/orgs/acme/teams/platform/repos?')) {
        return Promise.resolve(jsonResponse([{ name: 'repo-a', role_name: 'push' }]))
      }
      return Promise.resolve(jsonResponse([]))
    })

    render(<Root />)
    await connect()
    await waitFor(() => expect(screen.getByText('断开连接')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /权限看板/ }))

    await waitFor(() => expect(screen.getByTestId('column-push')).toHaveTextContent('repo-a'))
    expect(screen.getByRole('button', { name: '← 返回首页' })).toBeInTheDocument()
  })
})