import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubClient } from '../github/client'
import { SecretManager } from './SecretManager'

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    dropEffect: 'move',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as DOMStringList,
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

const ORG_SECRETS = [
  {
    name: 'NPM_TOKEN',
    visibility: 'private' as const,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const REPOS = [
  {
    id: 1,
    name: 'repo-a',
    full_name: 'acme/repo-a',
    html_url: 'https://github.com/acme/repo-a',
    private: true,
  },
  {
    id: 2,
    name: 'repo-b',
    full_name: 'acme/repo-b',
    html_url: 'https://github.com/acme/repo-b',
    private: true,
  },
]

function createClient() {
  const client = new GithubClient('token-value', 'acme')
  vi.spyOn(client, 'listOrgSecrets').mockResolvedValue(ORG_SECRETS)
  vi.spyOn(client, 'listOrgRepos').mockResolvedValue(REPOS)
  vi.spyOn(client, 'listRepoSecrets').mockResolvedValue([])
  return client
}

function renderManager(client: GithubClient) {
  return render(<SecretManager client={client} org="acme" onBack={() => {}} />)
}

async function waitForLoaded() {
  await screen.findByRole('link', { name: 'repo-a' })
  await waitFor(() => {
    expect(screen.queryByText('刷新中...')).not.toBeInTheDocument()
  })
}

function dragSecretOntoRepo(secretName: string, repoName: string) {
  const secretCard = screen.getByLabelText(`${secretName} 的值`).closest('.secret-card')!
  const repoCard = screen.getByRole('link', { name: repoName }).closest('.repo-secret-card')!
  const dataTransfer = createDataTransfer()
  fireEvent.dragStart(secretCard, { dataTransfer })
  fireEvent.drop(repoCard, { dataTransfer })
}

describe('SecretManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('filters private repos by name and shows matching count', async () => {
    const client = createClient()
    renderManager(client)
    await waitForLoaded()

    expect(screen.getByRole('link', { name: 'repo-a' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'repo-b' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('过滤私有仓库'), {
      target: { value: 'repo-a' },
    })

    expect(screen.getByRole('link', { name: 'repo-a' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'repo-b' })).not.toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('清空仓库过滤'))

    expect(screen.getByRole('link', { name: 'repo-b' })).toBeInTheDocument()
    expect(screen.queryByText('1/2')).not.toBeInTheDocument()
  })

  it('shows an empty state when the filter matches no repos', async () => {
    const client = createClient()
    renderManager(client)
    await waitForLoaded()

    fireEvent.change(screen.getByLabelText('过滤私有仓库'), {
      target: { value: 'no-such-repo' },
    })

    expect(screen.getByText('没有匹配的仓库')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'repo-a' })).not.toBeInTheDocument()
  })

  it('selects only filtered repos when using select-all', async () => {
    const client = createClient()
    renderManager(client)
    await waitForLoaded()

    fireEvent.change(screen.getByLabelText('过滤私有仓库'), {
      target: { value: 'repo-a' },
    })
    fireEvent.click(screen.getByRole('button', { name: '全选' }))

    expect(screen.getByText('已选 1 个仓库 · 拖拽 Secret 将批量应用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()
  })

  it('executes ops asynchronously and removes each from the pending list as it completes', async () => {
    const client = createClient()
    const deferred = new Map<
      string,
      { promise: Promise<void>; resolve: () => void }
    >()
    vi.spyOn(client, 'setRepoSecret').mockImplementation((repoName: string) => {
      let resolve!: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      deferred.set(repoName, { promise, resolve })
      return promise
    })

    renderManager(client)
    await waitForLoaded()

    fireEvent.change(screen.getByLabelText('NPM_TOKEN 的值'), {
      target: { value: 'super-secret' },
    })

    dragSecretOntoRepo('NPM_TOKEN', 'repo-a')
    dragSecretOntoRepo('NPM_TOKEN', 'repo-b')

    expect(screen.getByText('在 repo-a 设置 secret「NPM_TOKEN」')).toBeInTheDocument()
    expect(screen.getByText('在 repo-b 设置 secret「NPM_TOKEN」')).toBeInTheDocument()
    expect(screen.getByText('待执行 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行 (2)' }))

    await waitFor(() => {
      expect(deferred.size).toBe(2)
    })

    // 第一个操作完成后，待执行列表应缩减为只剩第二个操作
    deferred.get('repo-a')!.resolve()
    await waitFor(() => {
      expect(screen.queryByText('在 repo-a 设置 secret「NPM_TOKEN」')).not.toBeInTheDocument()
    })
    expect(screen.getByText('在 repo-b 设置 secret「NPM_TOKEN」')).toBeInTheDocument()
    expect(screen.getByText('待执行 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '执行中... (剩余 1)' })).toBeInTheDocument()

    // 第二个操作完成后，列表清空并显示成功提示
    deferred.get('repo-b')!.resolve()
    await waitFor(() => {
      expect(screen.getByText('全部 2 个 Secret 操作已完成。')).toBeInTheDocument()
    })
    expect(screen.queryByText('在 repo-b 设置 secret「NPM_TOKEN」')).not.toBeInTheDocument()
    expect(screen.getByText('待执行 0')).toBeInTheDocument()
  })

  it('keeps failed ops in the pending list for retry', async () => {
    const client = createClient()
    vi.spyOn(client, 'setRepoSecret').mockImplementation((repoName: string) => {
      if (repoName === 'repo-a') {
        return Promise.reject(new Error('API 拒绝'))
      }
      return Promise.resolve()
    })

    renderManager(client)
    await waitForLoaded()

    fireEvent.change(screen.getByLabelText('NPM_TOKEN 的值'), {
      target: { value: 'super-secret' },
    })

    dragSecretOntoRepo('NPM_TOKEN', 'repo-a')
    dragSecretOntoRepo('NPM_TOKEN', 'repo-b')

    fireEvent.click(screen.getByRole('button', { name: '确认执行 (2)' }))

    await waitFor(() => {
      expect(screen.getByText(/部分完成：成功 1 个，失败 1 个/)).toBeInTheDocument()
    })

    // 失败的操作保留在列表中供重试，成功的操作已移除
    expect(screen.getByText('在 repo-a 设置 secret「NPM_TOKEN」')).toBeInTheDocument()
    expect(screen.queryByText('在 repo-b 设置 secret「NPM_TOKEN」')).not.toBeInTheDocument()
    expect(screen.getByText('待执行 1')).toBeInTheDocument()
  })
})
