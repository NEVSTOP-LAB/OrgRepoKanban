import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const fetchMock = vi.fn<typeof fetch>()

describe('App', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows security note that PAT and organization are not persisted', () => {
    render(<App />)
    expect(screen.getByText('PAT 与组织名仅保存在当前页面内存中，不会写入本地存储。')).toBeInTheDocument()
  })

  it('loads admin board and displays default team permissions', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: 'admin' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 1, name: 'repo-a', full_name: 'acme/repo-a' },
            { id: 2, name: 'repo-b', full_name: 'acme/repo-b' },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 10, slug: 'platform', name: 'Platform', parent: null }]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'repo-a', role_name: 'push' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    render(<App />)

    fireEvent.change(screen.getByLabelText('个人访问令牌'), {
      target: { value: 'token-value' },
    })
    fireEvent.change(screen.getByLabelText('组织名称'), {
      target: { value: 'acme' },
    })
    fireEvent.click(screen.getByRole('button', { name: '连接组织' }))

    await waitFor(() => {
      expect(screen.getByTestId('column-push')).toHaveTextContent('repo-a')
    })

    expect(screen.getByTestId('column-none')).toHaveTextContent('repo-b')
    expect(screen.getByLabelText('团队选择')).toHaveValue('platform')
  })

  it('blocks non-admin token and shows warning', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ role: 'member' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    render(<App />)

    fireEvent.change(screen.getByLabelText('个人访问令牌'), {
      target: { value: 'token-value' },
    })
    fireEvent.change(screen.getByLabelText('组织名称'), {
      target: { value: 'acme' },
    })
    fireEvent.click(screen.getByRole('button', { name: '连接组织' }))

    await waitFor(() => {
      expect(screen.getByText('当前令牌不是该组织管理员，无法执行权限修改。')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('仓库权限看板')).not.toBeInTheDocument()
  })
})
