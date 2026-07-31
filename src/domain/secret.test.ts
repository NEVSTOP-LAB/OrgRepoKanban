import { describe, expect, it } from 'vitest'
import {
  addPendingOp,
  effectiveRepoSecrets,
  formatPendingOp,
  pendingOpsEqual,
  removePendingOpsForRepo,
  removePendingOpsForSecret,
  type PendingSecretOp,
} from './secret'

describe('addPendingOp', () => {
  it('adds a new set operation', () => {
    const result = addPendingOp([], 'repo-a', 'NPM_TOKEN', 'secret123', [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      repoName: 'repo-a',
      secretName: 'NPM_TOKEN',
      value: 'secret123',
      action: 'set',
    })
  })

  it('adds a delete operation when value is empty and secret was configured', () => {
    const result = addPendingOp([], 'repo-a', 'OLD_KEY', '', ['OLD_KEY'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      repoName: 'repo-a',
      secretName: 'OLD_KEY',
      value: '',
      action: 'delete',
    })
  })

  it('drops a no-op delete when secret was never configured', () => {
    const result = addPendingOp([], 'repo-a', 'GHOST', '', [])
    expect(result).toHaveLength(0)
  })

  it('drops a no-op set when value is empty', () => {
    const result = addPendingOp([], 'repo-a', 'X', '', ['X'])
    // value is empty → action becomes 'delete'; configured is true → keep
    expect(result).toHaveLength(1)
    expect(result[0].action).toBe('delete')
  })

  it('replaces an existing op for the same repo+secret', () => {
    const existing: PendingSecretOp[] = [
      { repoName: 'repo-a', secretName: 'NPM_TOKEN', value: 'old', action: 'set' },
    ]
    const result = addPendingOp(existing, 'repo-a', 'NPM_TOKEN', 'new', [])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('new')
  })

  it('keeps unrelated ops', () => {
    const existing: PendingSecretOp[] = [
      { repoName: 'repo-a', secretName: 'NPM_TOKEN', value: 'v1', action: 'set' },
      { repoName: 'repo-b', secretName: 'DEPLOY_KEY', value: 'v2', action: 'set' },
    ]
    const result = addPendingOp(
      existing,
      'repo-a',
      'NPM_TOKEN',
      'updated',
      [],
    )
    expect(result).toHaveLength(2)
    expect(result.find((o) => o.repoName === 'repo-b')).toBeTruthy()
    expect(
      result.find((o) => o.repoName === 'repo-a' && o.secretName === 'NPM_TOKEN'),
    ).toMatchObject({ value: 'updated' })
  })
})

describe('removePendingOpsForRepo', () => {
  it('removes all ops for a given repo', () => {
    const ops: PendingSecretOp[] = [
      { repoName: 'a', secretName: 'X', value: '1', action: 'set' },
      { repoName: 'b', secretName: 'Y', value: '2', action: 'set' },
      { repoName: 'a', secretName: 'Z', value: '3', action: 'set' },
    ]
    const result = removePendingOpsForRepo(ops, 'a')
    expect(result).toHaveLength(1)
    expect(result[0].repoName).toBe('b')
  })
})

describe('removePendingOpsForSecret', () => {
  it('removes all ops for a given secret', () => {
    const ops: PendingSecretOp[] = [
      { repoName: 'a', secretName: 'X', value: '1', action: 'set' },
      { repoName: 'b', secretName: 'X', value: '2', action: 'set' },
      { repoName: 'c', secretName: 'Y', value: '3', action: 'set' },
    ]
    const result = removePendingOpsForSecret(ops, 'X')
    expect(result).toHaveLength(1)
    expect(result[0].secretName).toBe('Y')
  })
})

describe('effectiveRepoSecrets', () => {
  it('returns configured secrets when no pending ops exist', () => {
    const result = effectiveRepoSecrets(['A', 'B'], [], 'repo-a')
    expect(result).toEqual(['A', 'B'])
  })

  it('adds secrets from pending set ops', () => {
    const ops: PendingSecretOp[] = [
      { repoName: 'repo-a', secretName: 'C', value: 'v', action: 'set' },
    ]
    const result = effectiveRepoSecrets(['A', 'B'], ops, 'repo-a')
    expect(result).toEqual(['A', 'B', 'C'])
  })

  it('removes secrets from pending delete ops', () => {
    const ops: PendingSecretOp[] = [
      { repoName: 'repo-a', secretName: 'A', value: '', action: 'delete' },
    ]
    const result = effectiveRepoSecrets(['A', 'B'], ops, 'repo-a')
    expect(result).toEqual(['B'])
  })

  it('ignores ops for other repos', () => {
    const ops: PendingSecretOp[] = [
      { repoName: 'repo-b', secretName: 'C', value: 'v', action: 'set' },
    ]
    const result = effectiveRepoSecrets(['A'], ops, 'repo-a')
    expect(result).toEqual(['A'])
  })
})

describe('formatPendingOp', () => {
  it('formats a set op', () => {
    const op: PendingSecretOp = {
      repoName: 'my-repo',
      secretName: 'NPM_TOKEN',
      value: '***',
      action: 'set',
    }
    expect(formatPendingOp(op)).toBe('在 my-repo 设置 secret「NPM_TOKEN」')
  })

  it('formats a delete op', () => {
    const op: PendingSecretOp = {
      repoName: 'my-repo',
      secretName: 'OLD_KEY',
      value: '',
      action: 'delete',
    }
    expect(formatPendingOp(op)).toBe('在 my-repo 删除 secret「OLD_KEY」')
  })
})

describe('pendingOpsEqual', () => {
  it('returns true for equal lists', () => {
    const a: PendingSecretOp[] = [
      { repoName: 'r', secretName: 's', value: 'v', action: 'set' },
    ]
    const b: PendingSecretOp[] = [
      { repoName: 'r', secretName: 's', value: 'v', action: 'set' },
    ]
    expect(pendingOpsEqual(a, b)).toBe(true)
  })

  it('returns false for different lengths', () => {
    expect(
      pendingOpsEqual(
        [{ repoName: 'r', secretName: 's', value: 'v', action: 'set' }],
        [],
      ),
    ).toBe(false)
  })

  it('returns false for different values', () => {
    expect(
      pendingOpsEqual(
        [{ repoName: 'r', secretName: 's', value: 'v1', action: 'set' }],
        [{ repoName: 'r', secretName: 's', value: 'v2', action: 'set' }],
      ),
    ).toBe(false)
  })
})
