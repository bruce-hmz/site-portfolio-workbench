export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>()
const dateOnlyFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const dateOnlyWeekdayFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' })

function dateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateKeyFormatters.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  dateKeyFormatters.set(timeZone, formatter)
  return formatter
}

export function isValidTimeZone(value: string): boolean {
  if (!value.trim()) return false
  try {
    dateKeyFormatter(value)
    return true
  } catch {
    return false
  }
}

export function normalizeTimeZone(value: string | null | undefined): string {
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = dateKeyFormatter(normalizeTimeZone(timeZone)).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return dateKeyInTimeZone(now, timeZone)
}

export function addDateDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dateOnlyValue(value: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN)
  return new Date(`${value}T12:00:00Z`)
}

export function formatDateOnly(value: string | null, timeZone: string): string {
  if (!value) return '未设置'
  const date = dateOnlyValue(value, timeZone)
  if (Number.isNaN(date.getTime())) return '未设置'
  return dateOnlyFormatter.format(date)
}

export function weekdayForDateOnly(value: string, timeZone: string): string {
  return dateOnlyWeekdayFormatter.format(dateOnlyValue(value, timeZone))
}

export function startOfWeekInTimeZone(timeZone: string, now = new Date()): string {
  const current = todayInTimeZone(timeZone, now)
  const sundayOffset = dateOnlyValue(current, timeZone).getUTCDay()
  return addDateDays(current, -sundayOffset)
}
