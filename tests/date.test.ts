import { describe, expect, it } from 'vitest'
import { addDateDays, dateOnlyValue, formatDateOnly, isValidTimeZone, normalizeTimeZone, startOfWeekInTimeZone, todayInTimeZone, weekdayForDateOnly, DEFAULT_TIMEZONE } from '../src/lib/dates'

describe('account timezone date boundaries', () => {
  it('keeps date-only values stable in UTC+14', () => {
    expect(formatDateOnly('2026-01-01', 'Pacific/Kiritimati')).toContain('1月1日')
    expect(weekdayForDateOnly('2026-01-01', 'Pacific/Kiritimati')).toBe('周四')
    expect(dateOnlyValue('2026-01-01', 'Pacific/Kiritimati').toISOString()).toBe('2026-01-01T12:00:00.000Z')
  })

  it('recomputes today when the account timezone crosses midnight', () => {
    expect(todayInTimeZone('Asia/Shanghai', new Date('2026-03-29T15:59:59Z'))).toBe('2026-03-29')
    expect(todayInTimeZone('Asia/Shanghai', new Date('2026-03-29T16:00:00Z'))).toBe('2026-03-30')
  })

  it('keeps the calendar date stable across the Berlin DST jump', () => {
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29')
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-03-29T01:30:00Z'))).toBe('2026-03-29')
    expect(startOfWeekInTimeZone('Europe/Berlin', new Date('2026-03-29T01:30:00Z'))).toBe('2026-03-29')
  })

  it('validates real timezone identifiers and falls back for invalid ones', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Not/A_Timezone')).toBe(false)
    expect(normalizeTimeZone('Not/A_Timezone')).toBe(DEFAULT_TIMEZONE)
    expect(todayInTimeZone('Not/A_Timezone', new Date('2026-03-29T18:00:00Z'))).toBe('2026-03-30')
  })

  it('does week arithmetic on date keys without DST shifts', () => {
    expect(startOfWeekInTimeZone('Europe/Berlin', new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-29')
    expect(addDateDays('2026-03-29', 1)).toBe('2026-03-30')
  })
})
