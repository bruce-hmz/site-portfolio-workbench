export type PageResponse<T> = {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

export class PaginationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaginationError'
  }
}

export async function readAllPages<T>(
  readPage: (from: number, to: number) => Promise<PageResponse<T>>,
  options: { pageSize: number; key: (item: T) => string },
): Promise<T[]> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1) {
    throw new PaginationError('分页大小必须是正整数')
  }

  const rows: T[] = []
  const seen = new Set<string>()
  let offset = 0
  let exactCount: number | null = null

  while (true) {
    const page = await readPage(offset, offset + options.pageSize - 1)
    if (page.error) throw new Error(page.error.message)
    if (page.count !== null) {
      if (exactCount !== null && exactCount !== page.count) {
        throw new PaginationError(`分页读取期间总数变化：${exactCount} → ${page.count}`)
      }
      exactCount = page.count
    }
    const data = page.data || []

    if (!data.length) {
      if (exactCount !== null && rows.length < exactCount) {
        throw new PaginationError(`分页读取在第 ${offset} 行停止，但 exact count 为 ${exactCount}`)
      }
      break
    }

    for (const item of data) {
      const key = options.key(item)
      if (seen.has(key)) throw new PaginationError(`分页读取返回重复记录：${key}`)
      seen.add(key)
      rows.push(item)
    }

    const returned = data.length
    if (returned > options.pageSize) throw new PaginationError(`分页返回 ${returned} 条，超过请求页大小 ${options.pageSize}`)
    offset += returned

    if (exactCount !== null && rows.length > exactCount) {
      throw new PaginationError(`分页读取返回 ${rows.length} 条，但 exact count 为 ${exactCount}`)
    }
    if (exactCount !== null && rows.length === exactCount) break
  }

  if (exactCount !== null && rows.length !== exactCount) {
    throw new PaginationError(`分页读取不完整：已读 ${rows.length} 条，exact count 为 ${exactCount}`)
  }
  return rows
}
