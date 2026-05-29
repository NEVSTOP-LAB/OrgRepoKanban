export type PermissionLevel =
  | 'none'
  | 'pull'
  | 'triage'
  | 'push'
  | 'maintain'
  | 'admin'

export const PERMISSION_COLUMNS: PermissionLevel[] = [
  'pull',
  'triage',
  'push',
  'maintain',
  'admin',
  'none',
]

export const PERMISSION_DISPLAY_LABELS: Record<PermissionLevel, string> = {
  none: '未授权',
  pull: 'Read',
  triage: 'Triage',
  push: 'Write',
  maintain: 'Maintain',
  admin: 'Admin',
}

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  pull: 1,
  triage: 2,
  push: 3,
  maintain: 4,
  admin: 5,
}

export function normalizePermission(value: string | null | undefined): PermissionLevel {
  if (!value) {
    return 'none'
  }

  const normalized = value.toLowerCase()
  if (normalized === 'pull' || normalized === 'read') {
    return 'pull'
  }

  if (normalized === 'triage') {
    return 'triage'
  }

  if (normalized === 'push' || normalized === 'write') {
    return 'push'
  }

  if (normalized === 'maintain') {
    return 'maintain'
  }

  if (normalized === 'admin') {
    return 'admin'
  }

  return 'none'
}

export function comparePermission(a: PermissionLevel, b: PermissionLevel): number {
  return PERMISSION_RANK[a] - PERMISSION_RANK[b]
}

export function pickHighestPermission(levels: PermissionLevel[]): PermissionLevel {
  if (levels.length === 0) {
    return 'none'
  }

  let highest: PermissionLevel = 'none'

  for (const level of levels) {
    if (comparePermission(level, highest) > 0) {
      highest = level
    }
  }

  return highest
}
