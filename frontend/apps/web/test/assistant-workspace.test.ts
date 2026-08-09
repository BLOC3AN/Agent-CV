import { describe, expect, it } from 'vitest'
import { assistantWorkspaceState } from '@/lib/assistant-workspace'

describe('assistant workspace transition', () => {
  it('starts as a focused assistant canvas before the first user turn', () => {
    expect(assistantWorkspaceState([], 'chat')).toBe('idle')
  })

  it('opens the live CV after the first user message', () => {
    expect(assistantWorkspaceState([{ role: 'user' }], 'chat')).toBe('active')
  })

  it('does not open early from an assistant-only restored message', () => {
    expect(assistantWorkspaceState([{ role: 'assistant' }], 'chat')).toBe('idle')
  })

  it('keeps the normal CV workspace when chat is closed or a section is focused', () => {
    expect(assistantWorkspaceState([], null)).toBe('active')
    expect(assistantWorkspaceState([], 'chat', '/work/0/role')).toBe('active')
  })
})
