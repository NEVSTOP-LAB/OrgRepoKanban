import { describe, expect, it } from 'vitest'

import { toggleSelection } from './selection'

describe('toggleSelection', () => {
  it('adds cards to selection when ctrl/cmd mode is enabled', () => {
    const selected = toggleSelection(new Set(['repo-a']), 'repo-b', true)
    expect(Array.from(selected.values()).sort()).toEqual(['repo-a', 'repo-b'])
  })

  it('toggles existing card in ctrl/cmd mode', () => {
    const selected = toggleSelection(new Set(['repo-a', 'repo-b']), 'repo-b', true)
    expect(Array.from(selected.values())).toEqual(['repo-a'])
  })

  it('replaces selection in single-click mode', () => {
    const selected = toggleSelection(new Set(['repo-a', 'repo-b']), 'repo-c', false)
    expect(Array.from(selected.values())).toEqual(['repo-c'])
  })
})
