import { describe, expect, test } from 'bun:test'
import { Option } from '#/shared-kernel/option.ts'

describe('Option.getOrNull', () => {
  test('returns null for None', () => {
    expect(Option.getOrNull(Option.none<Date>())).toBeNull()
  })

  test('returns the original value for Some', () => {
    const date = new Date('2030-01-01T00:00:00Z')
    expect(Option.getOrNull(Option.some(date))).toBe(date)
  })

  test('preserves falsy values', () => {
    expect(Option.getOrNull(Option.some(0))).toBe(0)
    expect(Option.getOrNull(Option.some(false))).toBe(false)
    expect(Option.getOrNull(Option.some(''))).toBe('')
  })
})
