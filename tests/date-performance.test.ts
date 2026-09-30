import { afterEach, expect, it, vi } from 'vitest'
import { todayInTimeZone } from '../src/lib/dates'

afterEach(() => vi.restoreAllMocks())

it('reuses the valid timezone formatter across 1000 today calculations', () => {
  const formatterConstructor = vi.spyOn(Intl, 'DateTimeFormat')
  const now = new Date('2026-03-29T18:00:00Z')
  let result = ''

  for (let index = 0; index < 1000; index += 1) {
    result = todayInTimeZone('Pacific/Chatham', now)
  }

  expect(result).toBe('2026-03-30')
  expect(formatterConstructor).toHaveBeenCalledTimes(1)
})
