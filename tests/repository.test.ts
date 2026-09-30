import { describe, expect, it } from 'vitest'
import { PaginationError, readAllPages } from '../src/lib/pagination'
import { loadCaptureById, loadCaptureDestination, loadCompletedCapturePage, loadSiteLogPage, loadWorkspace } from '../src/lib/repository'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Capture, Log, Task } from '../src/lib/types'

type Row = { id: string; order: number }

function cappedReader(rows: Row[], cap: number) {
  return async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + cap)),
    error: null,
    count: rows.length,
  })
}

function pagedClient(tables: Record<string, Record<string, unknown>[]>, cap: number) {
  const requests: Array<{ table: string; from: number; orders: string[] }> = []
  const client = {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = []
      const orders: string[] = []
      const source = tables[table] || []
      const matchingRows = () => source.filter((row) => filters.every(({ column, value }) => row[column] === value))
      const builder = {
        select() { return builder },
        eq(column: string, value: unknown) { filters.push({ column, value }); return builder },
        order(column: string) { orders.push(column); return builder },
        range(from: number, to: number) {
          requests.push({ table, from, orders: [...orders] })
          const rows = matchingRows()
          return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null, count: rows.length })
        },
        maybeSingle() {
          return Promise.resolve({ data: matchingRows()[0] || null, error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { client, requests }
}

describe('repository pagination', () => {
  it('continues from actual returned count when backend cap is 1000', async () => {
    const rows = Array.from({ length: 1207 }, (_, index) => ({ id: String(index), order: index }))
    await expect(readAllPages(cappedReader(rows, 1000), { pageSize: 1000, key: (row) => row.id })).resolves.toEqual(rows)
  })

  it('continues when backend cap is smaller than requested page size', async () => {
    const rows = Array.from({ length: 123 }, (_, index) => ({ id: String(index), order: index }))
    await expect(readAllPages(cappedReader(rows, 17), { pageSize: 50, key: (row) => row.id })).resolves.toEqual(rows)
  })

  it('keeps paging after a short page when count is unavailable', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: String(index), order: index }))
    const offsets: number[] = []
    const reader = async (from: number, to: number) => {
      offsets.push(from)
      return { data: rows.slice(from, Math.min(to + 1, from + 3)), error: null, count: null }
    }
    await expect(readAllPages(reader, { pageSize: 5, key: (row) => row.id })).resolves.toEqual(rows)
    expect(offsets).toEqual([0, 3, 6, 7])
  })

  it('preserves the backend stable order, including equal sort values', async () => {
    const rows = [
      { id: 'b', order: 1 }, { id: 'a', order: 1 }, { id: 'd', order: 2 }, { id: 'c', order: 2 },
    ]
    await expect(readAllPages(cappedReader(rows, 2), { pageSize: 50, key: (row) => row.id })).resolves.toEqual(rows)
  })

  it('throws when a partial read cannot make progress', async () => {
    const page = async () => ({ data: [{ id: 'same', order: 1 }], error: null, count: 2 })
    await expect(readAllPages(page, { pageSize: 1, key: (row) => row.id })).rejects.toBeInstanceOf(PaginationError)
  })

  it('fails explicitly when an empty page conflicts with the remaining exact count', async () => {
    const page = async () => ({ data: [], error: null, count: 2 })
    await expect(readAllPages(page, { pageSize: 10, key: (row) => row.id })).rejects.toThrow(/exact count 为 2/)
  })

  it('loads every large workspace collection across a smaller backend cap', async () => {
    const size = 1205
    const sites = Array.from({ length: size }, (_, index) => ({ id: `site-${index}`, updated_at: '2026-09-30' }))
    const tasks = [
      ...Array.from({ length: size }, (_, index) => ({ id: `task-${index}`, status: '待处理' })),
      { id: 'task-done', status: '完成' },
    ]
    const captures = [
      ...Array.from({ length: size }, (_, index) => ({ id: `capture-${index}`, status: '待整理' })),
      { id: 'capture-done', status: '已处理' },
    ]
    const opportunities = Array.from({ length: size }, (_, index) => ({ id: `opportunity-${index}` }))
    const tables: Record<string, Record<string, unknown>[]> = { sites, tasks, captures, opportunities }
    const pageCap = 37
    const reads: Array<{ table: string; from: number; orders: string[] }> = []

    const makeBuilder = (table: string, sourceRows: Record<string, unknown>[]) => {
      const filters: Array<{ kind: 'eq' | 'neq'; column: string; value: unknown }> = []
      const orders: string[] = []
      let range: [number, number] = [0, pageCap - 1]
      const builder: {
        select: () => typeof builder
        eq: (column: string, value: unknown) => typeof builder
        neq: (column: string, value: unknown) => typeof builder
        order: (column: string) => typeof builder
        range: (from: number, to: number) => typeof builder
        then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
      } = {
        select: () => builder,
        eq: (column, value) => { filters.push({ kind: 'eq', column, value }); return builder },
        neq: (column, value) => { filters.push({ kind: 'neq', column, value }); return builder },
        order: (column) => { orders.push(column); return builder },
        range: (from, to) => { range = [from, to]; return builder },
        then: (resolve, reject) => Promise.resolve().then(() => {
          const filtered = sourceRows.filter((row) => filters.every(({ kind, column, value }) => kind === 'eq' ? row[column] === value : row[column] !== value))
          reads.push({ table, from: range[0], orders: [...orders] })
          return { data: filtered.slice(range[0], Math.min(range[1] + 1, range[0] + pageCap)), error: null, count: filtered.length }
        }).then(resolve, reject),
      }
      return builder
    }

    const client = {
      from: (table: string) => makeBuilder(table, tables[table] || []),
      rpc: (_name: string, args: { p_site_ids: string[] }) => {
        const summaries = args.p_site_ids.map((site_id) => ({ site_id, latest_log: null, latest_report: null }))
        return makeBuilder('summaries', summaries)
      },
    } as unknown as SupabaseClient

    const result = await loadWorkspace(client)
    expect(result.sites).toHaveLength(size)
    expect(result.tasks).toHaveLength(size)
    expect(result.captures).toHaveLength(size)
    expect(result.opportunities).toHaveLength(size)
    expect(reads.filter((read) => ['sites', 'tasks', 'captures', 'opportunities'].includes(read.table)).some((read) => read.from >= 1100)).toBe(true)
    expect(reads.some((read) => read.table === 'sites' && read.orders.includes('id'))).toBe(true)
    expect(reads.some((read) => read.table === 'tasks' && read.orders.includes('id'))).toBe(true)
    expect(reads.some((read) => read.table === 'captures' && read.orders.includes('id'))).toBe(true)
    expect(reads.some((read) => read.table === 'opportunities' && read.orders.includes('id'))).toBe(true)
  })

  it('paginates completed captures and site logs and resolves old destinations by id', async () => {
    const completedCaptures: Capture[] = Array.from({ length: 123 }, (_, index) => ({
      id: `capture-${index}`, text: `capture text ${index}`, status: '已处理', created_at: `2026-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z`,
      processed_at: null, destination_log_id: null, destination_task_id: null, destination_opportunity_id: null, version: 1,
    }))
    const targetCapture = {
      ...completedCaptures[122], id: 'capture-target', destination_task_id: 'task-complete',
    }
    completedCaptures[122] = targetCapture
    const siteLogs: Log[] = Array.from({ length: 125 }, (_, index) => ({
      id: `log-${index}`, site_id: 'site-a', text: `log text ${index}`, source_type: 'source', source_url: null,
      observed_through: null, finalized_through: null, collected_at: `2026-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z`, confirmed: true, capture_id: null,
    }))
    const completedTask: Task = { id: 'task-complete', site_id: 'site-a', title: '已完成任务', type: '执行', due_on: '2026-01-01', status: '完成', source: 'capture', capture_id: 'capture-target', version: 2 }
    const { client, requests } = pagedClient({ captures: completedCaptures, logs: siteLogs, tasks: [completedTask] }, 17)

    const allCaptures: Capture[] = []
    for (let offset = 0; ; ) {
      const page = await loadCompletedCapturePage(client, offset, 50)
      allCaptures.push(...page.items)
      if (page.page.nextOffset === null) break
      offset = page.page.nextOffset
    }
    expect(allCaptures).toHaveLength(123)
    expect(new Set(allCaptures.map((capture) => capture.id)).size).toBe(123)

    const allLogs: Log[] = []
    for (let offset = 0; ; ) {
      const page = await loadSiteLogPage(client, 'site-a', offset, 50)
      allLogs.push(...page.items)
      if (page.page.nextOffset === null) break
      offset = page.page.nextOffset
    }
    expect(allLogs).toHaveLength(125)
    expect(new Set(allLogs.map((log) => log.id)).size).toBe(125)

    await expect(loadCaptureById(client, 'capture-target')).resolves.toMatchObject({ id: 'capture-target' })
    await expect(loadCaptureDestination(client, targetCapture)).resolves.toEqual({ kind: 'task', task: completedTask })
    expect(requests.filter((request) => request.table === 'logs').every((request) => request.orders.includes('id'))).toBe(true)
  })
})
