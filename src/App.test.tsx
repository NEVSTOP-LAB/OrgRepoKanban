import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const fetchMock = vi.fn<typeof fetch>()

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    dropEffect: 'move',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: (format?: string) => {
      if (!format) {
        store.clear()
        return
      }

      store.delete(format)
    },
    getData: (format: string) => store.get(format) ?? '',
    setData: (format: string, data: string) => {
      store.set(format, data)
    },
    setDragImage: () => {},
  } as unknown as DataTransfer
}

function dragRepoToColumn(repoName: string, column: string) {
  const dataTransfer = createDataTransfer()
  fireEvent.dragStart(screen.getByRole('button', { name: repoName }), {
    dataTransfer,
  })
  fireEvent.dragOver(screen.getByTestId(`column-${column}`), { dataTransfer })
  fireEvent.drop(screen.getByTestId(`column-${column}`), { dataTransfer })
}

function createDeferredResponse() {
  let resolveResponse: ((value: Response) => void) | undefined
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })

  return {
    promise,
    resolve(response: Response) {
      resolveResponse?.(response)
    },
  }
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
            {
              id: 1,
              name: 'repo-a',
              full_name: 'acme/repo-a',
              private: false,
              fork: false,
            },
            {
              id: 2,
              name: 'repo-b',
              full_name: 'acme/repo-b',
              private: true,
              fork: false,
            },
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
        new Response(
          JSON.stringify([{ login: 'alice', id: 100 }]),
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

  it('filters repositories with preset buttons', async () => {
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
            {
              id: 1,
              name: 'repo-a',
              full_name: 'acme/repo-a',
              private: false,
              fork: false,
            },
            {
              id: 2,
              name: 'repo-b',
              full_name: 'acme/repo-b',
              private: true,
              fork: false,
            },
            {
              id: 3,
              name: 'repo-c',
              full_name: 'acme/repo-c',
              private: true,
              fork: true,
            },
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
        new Response(
          JSON.stringify([{ login: 'alice', id: 100 }]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { name: 'repo-a', role_name: 'push' },
            { name: 'repo-b', role_name: 'pull' },
            { name: 'repo-c', role_name: 'maintain' },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
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

    fireEvent.click(screen.getByRole('button', { name: '仅 Public' }))

    expect(screen.getByTestId('column-push')).toHaveTextContent('repo-a')
    expect(screen.getByTestId('column-pull')).not.toHaveTextContent('repo-b')
    expect(screen.getByTestId('column-maintain')).not.toHaveTextContent('repo-c')

    fireEvent.click(screen.getByRole('button', { name: '仅 Forked' }))

    expect(screen.getByTestId('column-maintain')).toHaveTextContent('repo-c')
    expect(screen.getByTestId('column-push')).not.toHaveTextContent('repo-a')
  })

  it('queues single moves sequentially without showing confirmation', async () => {
    const firstWrite = createDeferredResponse()
    const secondWrite = createDeferredResponse()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fetchMock.mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/user/memberships/orgs/acme')) {
        return Promise.resolve(
          new Response(JSON.stringify({ role: 'admin' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      if (url.includes('/orgs/acme/repos')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 1,
                name: 'repo-a',
                full_name: 'acme/repo-a',
                private: false,
                fork: false,
              },
              {
                id: 2,
                name: 'repo-b',
                full_name: 'acme/repo-b',
                private: false,
                fork: false,
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/orgs/acme/teams?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: 10, slug: 'platform', name: 'Platform', parent: null }]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/orgs/acme/members')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ login: 'alice', id: 100 }]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/orgs/acme/teams/platform/repos?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { name: 'repo-a', role_name: 'push' },
              { name: 'repo-b', role_name: 'pull' },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
      }

      if (method === 'PUT' && url.includes('/repo-a')) {
        return firstWrite.promise
      }

      if (method === 'PUT' && url.includes('/repo-b')) {
        return secondWrite.promise
      }

      return Promise.resolve(new Response(null, { status: 204 }))
    })

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

    dragRepoToColumn('repo-a', 'admin')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    dragRepoToColumn('repo-b', 'maintain')

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(6)

    firstWrite.resolve(new Response(null, { status: 204 }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(7)
    })

    secondWrite.resolve(new Response(null, { status: 204 }))

    await waitFor(() => {
      expect(screen.getByTestId('column-admin')).toHaveTextContent('repo-a')
      expect(screen.getByTestId('column-maintain')).toHaveTextContent('repo-b')
    })

    confirmSpy.mockRestore()
  })

  it('shows confirmation only for multi-repo moves', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

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
            {
              id: 1,
              name: 'repo-a',
              full_name: 'acme/repo-a',
              private: false,
              fork: false,
            },
            {
              id: 2,
              name: 'repo-b',
              full_name: 'acme/repo-b',
              private: false,
              fork: false,
            },
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
        new Response(
          JSON.stringify([{ login: 'alice', id: 100 }]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { name: 'repo-a', role_name: 'push' },
            { name: 'repo-b', role_name: 'pull' },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
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

    fireEvent.click(screen.getByRole('button', { name: 'repo-a' }), {
      ctrlKey: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'repo-b' }), {
      ctrlKey: true,
    })

    dragRepoToColumn('repo-a', 'admin')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)

    confirmSpy.mockRestore()
  })

  it('loads user permissions on-demand when switching to user mode', async () => {
    function makeAdminResponse() {
      return new Response(JSON.stringify({ role: 'admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    function makeReposResponse() {
      return new Response(
        JSON.stringify([
          { id: 1, name: 'repo-a', full_name: 'acme/repo-a', private: false, fork: false },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    function makeTeamsResponse() {
      return new Response(
        JSON.stringify([{ id: 10, slug: 'platform', name: 'Platform', parent: null }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    function makeMembersResponse() {
      return new Response(
        JSON.stringify([{ login: 'alice', id: 100 }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    function makeTeamReposResponse() {
      return new Response(JSON.stringify([{ name: 'repo-a', role_name: 'push' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    function makeUserPermissionResponse(permission: string) {
      return new Response(
        JSON.stringify({ permission, role_name: permission }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    // Initial connect: admin check, repos, teams, members, team repos
    fetchMock
      .mockResolvedValueOnce(makeAdminResponse())
      .mockResolvedValueOnce(makeReposResponse())
      .mockResolvedValueOnce(makeTeamsResponse())
      .mockResolvedValueOnce(makeMembersResponse())
      .mockResolvedValueOnce(makeTeamReposResponse())

    render(<App />)

    fireEvent.change(screen.getByLabelText('个人访问令牌'), { target: { value: 'token-value' } })
    fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: '连接组织' }))

    await waitFor(() => {
      expect(screen.getByTestId('column-push')).toHaveTextContent('repo-a')
    })

    // Switch to user mode; this triggers loading user permissions for alice
    // getUserRepoPermission for repo-a + listUserTeams (list teams then membership check)
    fetchMock
      .mockResolvedValueOnce(makeUserPermissionResponse('admin'))
      .mockResolvedValueOnce(makeTeamsResponse()) // listUserTeams calls listTeams
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'active' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) // membership check for platform team
      .mockResolvedValueOnce(makeTeamReposResponse()) // load platform team repos

    fireEvent.change(screen.getByLabelText('主体类型'), { target: { value: 'user' } })

    await waitFor(() => {
      expect(screen.getByLabelText('个人协作者')).toHaveValue('alice')
    })

    await waitFor(() => {
      expect(screen.getByTestId('column-admin')).toHaveTextContent('repo-a')
    })

    // And the subject kind selector should still be on user mode
    expect(screen.getByLabelText('主体类型')).toHaveValue('user')
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
