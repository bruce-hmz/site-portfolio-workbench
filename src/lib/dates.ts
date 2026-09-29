export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return Boolean(value.trim())
  } catch {
    return false
  }
}

export function normalizeTimeZone(value: string | null | undefined): string {
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
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
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(date)
}

export function weekdayForDateOnly(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(dateOnlyValue(value, timeZone))
}

export function startOfWeekInTimeZone(timeZone: string, now = new Date()): string {
  const current = todayInTimeZone(timeZone, now)
  const sundayOffset = dateOnlyValue(current, timeZone).getUTCDay()
  return addDateDays(current, -sundayOffset)
}
