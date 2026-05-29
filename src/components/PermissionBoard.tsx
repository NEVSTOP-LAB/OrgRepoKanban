import { buildBoardColumns, type RepoSummary } from '../domain/board'
import {
  PERMISSION_COLUMNS,
  PERMISSION_DISPLAY_LABELS,
  type PermissionLevel,
} from '../domain/permissions'
import type { RepoFilterPreset } from '../domain/board'

interface MovePayload {
  repoNames: string[]
}

export interface PermissionBoardProps {
  repos: RepoSummary[]
  permissionByRepo: Record<string, PermissionLevel>
  filterQuery: string
  filterPreset?: RepoFilterPreset
  selectedRepos: Set<string>
  interactive?: boolean
  onToggleSelect: (repoName: string, additive: boolean) => void
  onMoveRequested: (repoNames: string[], target: PermissionLevel) => void
}

function parsePayload(raw: string): MovePayload | null {
  if (!raw) {
    return null
  }

  try {
    const payload = JSON.parse(raw) as Partial<MovePayload>
    if (!Array.isArray(payload.repoNames)) {
      return null
    }

    return {
      repoNames: payload.repoNames,
    }
  } catch {
    return null
  }
}

export function PermissionBoard(props: PermissionBoardProps) {
  const {
    repos,
    permissionByRepo,
    filterQuery,
    filterPreset = 'all',
    selectedRepos,
    interactive = true,
    onToggleSelect,
    onMoveRequested,
  } = props

  const columns = buildBoardColumns(repos, permissionByRepo, filterQuery, filterPreset)
  const visibleRepoNames = new Set(
    Object.values(columns)
      .flat()
      .map((repo) => repo.name),
  )

  const onDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    repoName: string,
  ) => {
    const selectedGroup = selectedRepos.has(repoName)
      ? Array.from(selectedRepos.values()).filter((name) => visibleRepoNames.has(name))
      : [repoName]

    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ repoNames: selectedGroup }),
    )
    event.dataTransfer.setData('text/plain', selectedGroup.join(','))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDrop = (
    event: React.DragEvent<HTMLElement>,
    target: PermissionLevel,
  ) => {
    event.preventDefault()
    if (!interactive) {
      return
    }

    const payload = parsePayload(event.dataTransfer.getData('application/json'))
    if (!payload || payload.repoNames.length === 0) {
      return
    }

    onMoveRequested(payload.repoNames, target)
  }

  return (
    <section className="permission-board" aria-label="仓库权限看板">
      {PERMISSION_COLUMNS.map((column) => (
        <article
          key={column}
          className="permission-column"
          data-testid={`column-${column}`}
          onDragOver={(event) => {
            if (!interactive) {
              return
            }

            event.preventDefault()
          }}
          onDrop={(event) => onDrop(event, column)}
        >
          <header className="column-header">
            <h3>{PERMISSION_DISPLAY_LABELS[column]}</h3>
            <span>{columns[column].length}</span>
          </header>

          <div className="column-cards">
            {columns[column].map((repo) => {
              const selected = selectedRepos.has(repo.name)

              return (
                <button
                  key={repo.id}
                  type="button"
                  draggable={interactive}
                  className={`repo-card ${selected ? 'selected' : ''}`}
                  onClick={(event) =>
                    onToggleSelect(repo.name, event.ctrlKey || event.metaKey)
                  }
                  onDragStart={(event) => {
                    if (!interactive) {
                      event.preventDefault()
                      return
                    }

                    onDragStart(event, repo.name)
                  }}
                  aria-label={repo.name}
                >
                  <span className="repo-card-name">{repo.name}</span>
                  <a
                    className="repo-card-link"
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`在 GitHub 中打开 ${repo.name}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    ↗
                  </a>
                </button>
              )
            })}
          </div>
        </article>
      ))}
    </section>
  )
}
