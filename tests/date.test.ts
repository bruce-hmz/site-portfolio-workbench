import { describe, expect, it } from 'vitest'
import { addDateDays, formatDateOnly, startOfWeekInTimeZone, todayInTimeZone, weekdayForDateOnly } from '../src/lib/dates'

describe('account timezone date boundaries', () => {
  it('keeps date-only values stable in UTC+14', () => {
    expect(formatDateOnly('2026-01-01', 'Pacific/Kiritimati')).toContain('1月1日')
    expect(weekdayForDateOnly('2026-01-01', 'Pacific/Kiritimati')).toBe('周四')
  })

  it('uses the account timezone for timestamp based today around DST', () => {
    const beforeMidnightUtc = new Date('2026-03-29T22:30:00Z')
    expect(todayInTimeZone('Europe/Berlin', beforeMidnightUtc)).toBe('2026-03-30')
    expect(todayInTimeZone('America/New_York', beforeMidnightUtc)).toBe('2026-03-29')
  })

  it('does week arithmetic on date keys without DST shifts', () => {
    expect(startOfWeekInTimeZone('Europe/Berlin', new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-29')
    expect(addDateDays('2026-03-29', 1)).toBe('2026-03-30')
  })
})
