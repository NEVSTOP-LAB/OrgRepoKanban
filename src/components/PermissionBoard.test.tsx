import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PermissionLevel } from '../domain/permissions'
import type { RepoSummary } from '../domain/board'
import { PermissionBoard } from './PermissionBoard'

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

const repos: RepoSummary[] = [
  { id: 1, name: 'repo-a', fullName: 'acme/repo-a' },
  { id: 2, name: 'repo-b', fullName: 'acme/repo-b' },
]

const permissionByRepo: Record<string, PermissionLevel> = {
  'repo-a': 'pull',
  'repo-b': 'none',
}

describe('PermissionBoard', () => {
  it('renders repositories in corresponding permission columns', () => {
    render(
      <PermissionBoard
        repos={repos}
        permissionByRepo={permissionByRepo}
        filterQuery=""
        selectedRepos={new Set<string>()}
        onToggleSelect={vi.fn()}
        onMoveRequested={vi.fn()}
      />,
    )

    expect(screen.getByTestId('column-pull')).toHaveTextContent('repo-a')
    expect(screen.getByTestId('column-none')).toHaveTextContent('repo-b')
  })

  it('supports ctrl/cmd multi-select callback', () => {
    const onToggleSelect = vi.fn()

    render(
      <PermissionBoard
        repos={repos}
        permissionByRepo={permissionByRepo}
        filterQuery=""
        selectedRepos={new Set<string>()}
        onToggleSelect={onToggleSelect}
        onMoveRequested={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'repo-a' }), {
      ctrlKey: true,
    })

    expect(onToggleSelect).toHaveBeenCalledWith('repo-a', true)
  })

  it('drops selected repos to target permission', () => {
    const onMoveRequested = vi.fn()

    render(
      <PermissionBoard
        repos={repos}
        permissionByRepo={permissionByRepo}
        filterQuery=""
        selectedRepos={new Set(['repo-a', 'repo-b'])}
        onToggleSelect={vi.fn()}
        onMoveRequested={onMoveRequested}
      />,
    )

    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(screen.getByRole('button', { name: 'repo-a' }), {
      dataTransfer,
    })
    fireEvent.dragOver(screen.getByTestId('column-push'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('column-push'), { dataTransfer })

    expect(onMoveRequested).toHaveBeenCalledWith(['repo-a', 'repo-b'], 'push')
  })
})
