import { buildBoardColumns, type RepoSummary } from '../domain/board'
import {
  PERMISSION_COLUMNS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_DISPLAY_LABELS,
  type PermissionLevel,
} from '../domain/permissions'
import type { InheritedFilter, RepoFilterPreset } from '../domain/board'

interface MovePayload {
  repoNames: string[]
}

export interface PermissionBoardProps {
  repos: RepoSummary[]
  permissionByRepo: Record<string, PermissionLevel>
  filterQuery: string
  filterPreset?: RepoFilterPreset
  inheritedFilter?: InheritedFilter
  parentPermissionByRepo?: Record<string, PermissionLevel> | null
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
    inheritedFilter = 'all',
    parentPermissionByRepo = null,
    selectedRepos,
    interactive = true,
    onToggleSelect,
    onMoveRequested,
  } = props

  const columns = buildBoardColumns(repos, permissionByRepo, filterQuery, filterPreset, inheritedFilter, parentPermissionByRepo)
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
            <h3 title={PERMISSION_DESCRIPTIONS[column]}>{PERMISSION_DISPLAY_LABELS[column]}</h3>
            <span>{columns[column].length}</span>
          </header>

          <span className="column-watermark" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i}>{PERMISSION_DISPLAY_LABELS[column]}</span>
            ))}
          </span>

          <div className="column-cards">
            {columns[column].map((repo) => {
              const selected = selectedRepos.has(repo.name)

              return (
                <button
                  key={repo.id}
                  type="button"
                  draggable={interactive}
                  className={`repo-card ${selected ? 'selected' : ''}`}
                  onClick={(event) => {
                    const additive = event.ctrlKey || event.metaKey
                    // Plain click on selected card: toggle off
                    if (!additive && selected) {
                      onToggleSelect(repo.name, true)
                    } else {
                      onToggleSelect(repo.name, additive)
                    }
                  }}
                  onDragStart={(event) => {
                    if (!interactive) {
                      event.preventDefault()
                      return
                    }

                    onDragStart(event, repo.name)
                  }}
                  aria-label={repo.name}
                >
                  <div className="repo-card-info">
                    <span className="repo-card-name">{repo.name}</span>
                    <span className="repo-card-tags">
                      <span className={`repo-tag ${repo.isPrivate ? 'is-private' : 'is-public'}`}>
                        {repo.isPrivate ? '私有' : '公开'}
                      </span>
                      {repo.topics?.map((t) => (
                        <span key={t} className="repo-tag is-topic">{t}</span>
                      ))}
                      {repo.accessList?.map((entry, i) => (
                        <span key={`${entry.kind}-${entry.name}-${i}`} className={`repo-tag is-access ${entry.kind}`}>
                          {entry.kind === 'team' ? '👥' : '👤'}{entry.name}:{PERMISSION_DISPLAY_LABELS[entry.permission]}
                        </span>
                      ))}
                    </span>
                  </div>
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
