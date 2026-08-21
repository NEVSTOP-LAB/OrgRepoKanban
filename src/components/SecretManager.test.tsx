import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubClient } from '../github/client'
import { SecretManager } from './SecretManager'

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
})
