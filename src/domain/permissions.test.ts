import { describe, expect, it } from 'vitest'

import {
  normalizePermission,
  pickHighestPermission,
  type PermissionLevel,
} from './permissions'

describe('normalizePermission', () => {
  it('maps github permission strings to supported levels', () => {
    expect(normalizePermission('pull')).toBe('pull')
    expect(normalizePermission('triage')).toBe('triage')
    expect(normalizePermission('push')).toBe('push')
    expect(normalizePermission('maintain')).toBe('maintain')
    expect(normalizePermission('admin')).toBe('admin')
  })

  it('maps unknown or missing permissions to none', () => {
    expect(normalizePermission('owner')).toBe('none')
    expect(normalizePermission(undefined)).toBe('none')
    expect(normalizePermission(null)).toBe('none')
  })
})

describe('pickHighestPermission', () => {
  it('returns only the highest effective permission', () => {
    const levels: PermissionLevel[] = ['pull', 'push', 'triage']
    expect(pickHighestPermission(levels)).toBe('push')
  })

  it('returns admin when present', () => {
    const levels: PermissionLevel[] = ['maintain', 'admin', 'pull']
    expect(pickHighestPermission(levels)).toBe('admin')
  })

  it('returns none for empty list', () => {
    expect(pickHighestPermission([])).toBe('none')
  })
})
