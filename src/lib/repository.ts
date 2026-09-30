import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TIMEZONE, isValidTimeZone, normalizeTimeZone } from './dates'
import { PaginationError, readAllPages, type PageResponse } from './pagination'
import type { Capture, CaptureDestination, CompletedCapturePage, Log, Opportunity, PageMeta, Report, ReportDraft, Site, SiteLogPage, Task, TimelineDraft } from './types'

export type WorkspaceData = {
  sites: Site[]
  tasks: Task[]
  captures: Capture[]
  opportunities: Opportunity[]
  logs: Log[]
  reports: Report[]
}

const siteColumns = 'id,name,phase,strategy,current_goal,last_decision,next_action,asset_links,next_checkpoint,strategy_condition,strategy_condition_due_on,archive_reason,updated_at,version'
const captureColumns = 'id,text,status,created_at,processed_at,destination_log_id,destination_task_id,destination_opportunity_id,version'
const taskColumns = 'id,site_id,title,type,due_on,status,source,capture_id,version'
const logColumns = 'id,site_id,text,source_type,source_url,observed_through,finalized_through,collected_at,confirmed,capture_id'
const opportunityColumns = 'id,problem,evidence,validation,scope,budget,pass_condition,stop_condition,status,site_id,capture_id,version'
const DEFAULT_PAGE_SIZE = 1000
const COMPLETED_CAPTURE_PAGE_SIZE = 50
const HISTORY_PAGE_SIZE = 50

function databaseError(error: { message: string }): Error {
  if (error.message.includes('version conflict')) return new Error('记录已更新或已处理，请刷新数据、核对最新状态后重新确认')
  if (error.message.includes('finalized date exceeds observed date')) return new Error('最终确认日期不能晚于观察截止日期；请先填写观察截止日期')
  if (error.message.includes('source URL must use http or https')) return new Error('来源 URL 必须使用 http 或 https')
  return new Error(error.message)
}

function pageMeta(offset: number, count: number | null, returned: number): PageMeta {
  if (count !== null && returned === 0 && offset < count) {
    throw new PaginationError(`分页读取在第 ${offset} 行停止，但 exact count 为 ${count}`)
  }
  if (count !== null && offset + returned > count) {
    throw new PaginationError(`分页读取返回到第 ${offset + returned} 行，但 exact count 为 ${count}`)
  }
  const hasMore = count === null ? returned > 0 : offset + returned < count
  const nextOffset = hasMore ? offset + returned : null
  return { offset, nextOffset, total: count, hasMore }
}

function requirePage<T>(result: PageResponse<T>): PageResponse<T> {
  if (result.error) throw databaseError(result.error)
  return result
}

async function readAll<T>(
  readPage: (from: number, to: number) => Promise<PageResponse<T>>,
  key: (item: T) => string,
): Promise<T[]> {
  try {
    return await readAllPages(readPage, { pageSize: DEFAULT_PAGE_SIZE, key })
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error(String(error))
  }
}

async function readCompletedCapturePage(client: SupabaseClient, offset: number, pageSize: number): Promise<CompletedCapturePage> {
  const result = requirePage(await (client.from('captures')
    .select(captureColumns, { count: 'exact' })
    .eq('status', '已处理')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + pageSize - 1) as unknown as Promise<PageResponse<Capture>>))
  const items = result.data || []
  return { items: items as Capture[], page: pageMeta(offset, result.count, items.length) }
}

export async function loadWorkspace(client: SupabaseClient): Promise<WorkspaceData> {
  const [sites, tasks, captures, opportunities] = await Promise.all([
    readAll<Site>((from, to) => client.from('sites').select(siteColumns, { count: 'exact' }).order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to) as unknown as Promise<PageResponse<Site>>, item => item.id),
    readAll<Task>((from, to) => client.from('tasks').select(taskColumns, { count: 'exact' }).neq('status', '完成').order('due_on').order('id').range(from, to) as unknown as Promise<PageResponse<Task>>, item => item.id),
    readAll<Capture>((from, to) => client.from('captures').select(captureColumns, { count: 'exact' }).eq('status', '待整理').order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to) as unknown as Promise<PageResponse<Capture>>, item => item.id),
    readAll<Opportunity>((from, to) => client.from('opportunities').select(opportunityColumns, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to) as unknown as Promise<PageResponse<Opportunity>>, item => item.id),
  ])

  const summaries = await loadSiteReadSummaries(client, sites.map((site) => site.id))
  return {
    sites,
    tasks,
    captures,
    opportunities,
    logs: summaries.flatMap((summary) => summary.latestLog ? [summary.latestLog] : []),
    reports: summaries.flatMap((summary) => summary.latestReport ? [summary.latestReport] : []),
  }
}

type SiteReadSummary = { siteId: string; latestLog: Log | null; latestReport: Report | null }

async function readSummaryBatch(client: SupabaseClient, siteIds: string[]): Promise<SiteReadSummary[]> {
  const rows = await readAllPages<{
    site_id: string
    latest_log: Log | null
    latest_report: Report | null
  }>(
    (from, to) => client.rpc('load_site_read_summaries', { p_site_ids: siteIds }, { count: 'exact' })
      .order('site_id')
      .range(from, to) as unknown as Promise<PageResponse<{ site_id: string; latest_log: Log | null; latest_report: Report | null }>>,
    { pageSize: DEFAULT_PAGE_SIZE, key: (row) => row.site_id },
  )
  return rows.map((row) => ({ siteId: row.site_id, latestLog: row.latest_log, latestReport: row.latest_report }))
}

export async function loadSiteReadSummaries(client: SupabaseClient, siteIds: string[]): Promise<SiteReadSummary[]> {
  const summaries: SiteReadSummary[] = []
  for (let offset = 0; offset < siteIds.length; offset += 100) {
    summaries.push(...await readSummaryBatch(client, siteIds.slice(offset, offset + 100)))
  }
  return summaries
}

export async function loadCompletedCapturePage(client: SupabaseClient, offset = 0, pageSize = COMPLETED_CAPTURE_PAGE_SIZE): Promise<CompletedCapturePage> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error('completed capture offset 必须是非负整数')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('completed capture page size 必须是正整数')
  return readCompletedCapturePage(client, offset, pageSize)
}

export async function loadSiteLogPage(client: SupabaseClient, siteId: string, offset = 0, pageSize = HISTORY_PAGE_SIZE): Promise<SiteLogPage> {
  if (!siteId) throw new Error('siteId 不能为空')
  if (!Number.isInteger(offset) || offset < 0) throw new Error('site log offset 必须是非负整数')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('site log page size 必须是正整数')
  const result = requirePage(await (client.from('logs')
    .select(logColumns, { count: 'exact' })
    .eq('site_id', siteId)
    .order('collected_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + pageSize - 1) as unknown as Promise<PageResponse<Log>>))
  const items = result.data || []
  return { items: items as Log[], page: pageMeta(offset, result.count, items.length) }
}

export async function loadLogById(client: SupabaseClient, logId: string): Promise<Log | null> {
  if (!logId) throw new Error('logId 不能为空')
  const result = await client.from('logs').select(logColumns).eq('id', logId).maybeSingle()
  if (result.error) throw databaseError(result.error)
  return result.data as Log | null
}

export async function loadCaptureById(client: SupabaseClient, captureId: string): Promise<Capture | null> {
  if (!captureId) throw new Error('captureId 不能为空')
  const result = await client.from('captures').select(captureColumns).eq('id', captureId).maybeSingle()
  if (result.error) throw databaseError(result.error)
  return result.data as Capture | null
}

export async function loadCaptureDestination(client: SupabaseClient, capture: Capture): Promise<CaptureDestination> {
  if (capture.destination_log_id) {
    const log = await loadLogById(client, capture.destination_log_id)
    return { kind: 'log', log }
  }
  if (capture.destination_task_id) {
    const result = await client.from('tasks').select(taskColumns).eq('id', capture.destination_task_id).maybeSingle()
    if (result.error) throw databaseError(result.error)
    return { kind: 'task', task: result.data as Task | null }
  }
  if (capture.destination_opportunity_id) {
    const result = await client.from('opportunities').select(opportunityColumns).eq('id', capture.destination_opportunity_id).maybeSingle()
    if (result.error) throw databaseError(result.error)
    return { kind: 'opportunity', opportunity: result.data as Opportunity | null }
  }
  return { kind: 'missing', id: capture.id }
}

export async function loadProfileTimezone(client: SupabaseClient): Promise<string> {
  const result = await client.from('profiles').select('timezone').maybeSingle()
  if (result.error) throw databaseError(result.error)
  return normalizeTimeZone(result.data?.timezone || DEFAULT_TIMEZONE)
}

export async function saveProfileTimezone(client: SupabaseClient, timezone: string): Promise<string> {
  if (!isValidTimeZone(timezone)) throw new Error('请输入有效的 IANA 时区')
  const user = await client.auth.getUser()
  if (user.error || !user.data.user) throw new Error(user.error?.message || '当前登录账号不可用')
  const result = await client.from('profiles').upsert({ id: user.data.user.id, timezone }, { onConflict: 'id' }).select('timezone').single()
  if (result.error) throw databaseError(result.error)
  return normalizeTimeZone(result.data.timezone)
}

export async function updateTask(client: SupabaseClient, task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>): Promise<Task> {
  const result = await client.from('tasks').update({ ...patch, version: task.version + 1 }).eq('id', task.id).eq('version', task.version).select('id,site_id,title,type,due_on,status,source,capture_id,version').single()
  if (result.error) {
    if (result.error.code === 'PGRST116') throw new Error('STALE_CONFLICT')
    throw databaseError(result.error)
  }
  if (!result.data) throw new Error('STALE_CONFLICT')
  return result.data as Task
}

export async function createCapture(client: SupabaseClient, text: string): Promise<Capture> {
  if (!text.trim()) throw new Error('随手记不能是空白文字')
  const result = await client.from('captures').insert({ text: text.trim() }).select(captureColumns).single()
  if (result.error) throw databaseError(result.error)
  return result.data as Capture
}

export async function createSite(client: SupabaseClient, name: string): Promise<Site> {
  if (!name.trim()) throw new Error('网站名称不能为空')
  const result = await client.from('sites').insert({ name: name.trim(), phase: '机会验证', strategy: '推进' })
    .select(siteColumns).single()
  if (result.error) throw databaseError(result.error)
  return result.data as Site
}

export async function createTask(client: SupabaseClient, siteId: string, title: string, dueOn: string): Promise<Task> {
  const date = new Date(`${dueOn}T12:00:00`)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueOn)
    && !Number.isNaN(date.getTime())
    && [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') === dueOn
  if (!siteId || !title.trim() || !validDate) throw new Error('请填写网站、任务标题和真实日期')
  const result = await client.from('tasks').insert({ site_id: siteId, title: title.trim(), type: '执行', due_on: dueOn })
    .select('id,site_id,title,type,due_on,status,source,capture_id,version').single()
  if (result.error) throw databaseError(result.error)
  return result.data as Task
}

export async function updateSiteStrategy(client: SupabaseClient, site: Site, strategy: string, condition: string, dueOn: string, archiveReason: string): Promise<Site> {
  if (strategy === '观察' && (!condition.trim() || !dueOn)) throw new Error('观察需要等待条件和检查日期')
  if (strategy === '暂停' && !condition.trim()) throw new Error('暂停需要重启条件')
  if (strategy === '归档' && !archiveReason.trim()) throw new Error('归档需要原因')
  const result = await client.rpc('set_site_strategy', { p_site_id: site.id, p_expected_version: site.version,
    p_strategy: strategy, p_condition: condition || null, p_condition_due_on: strategy === '观察' ? dueOn : null,
    p_archive_reason: archiveReason || null })
  if (result.error) throw databaseError(result.error)
  return result.data as Site
}

export type OpportunityFields = Pick<Opportunity, 'problem' | 'evidence' | 'validation' | 'scope' | 'budget' | 'pass_condition' | 'stop_condition'>

export type SiteContextFields = Pick<Site, 'name' | 'phase' | 'current_goal' | 'last_decision' | 'asset_links'>

export async function updateSiteContext(client: SupabaseClient, site: Site, fields: SiteContextFields): Promise<Site> {
  if (!fields.name.trim()) throw new Error('网站名称不能为空')
  for (const link of fields.asset_links.split('\n').map((value) => value.trim()).filter(Boolean)) {
    let valid = false
    try { valid = ['http:', 'https:'].includes(new URL(link).protocol) } catch { valid = false }
    if (!valid) throw new Error(`资产链接无效：${link}`)
  }
  const result = await client.from('sites').update({ ...fields, name: fields.name.trim(), version: site.version + 1 })
    .eq('id', site.id).eq('version', site.version).select(siteColumns).single()
  if (result.error?.code === 'PGRST116') throw new Error('其他设备已更新网站，请刷新后重新确认')
  if (result.error) throw databaseError(result.error)
  return result.data as Site
}

export async function createOpportunity(client: SupabaseClient, fields: OpportunityFields): Promise<Opportunity> {
  if (Object.values(fields).some((value) => !value.trim())) throw new Error('请补齐机会的全部字段')
  const result = await client.from('opportunities').insert(fields).select(opportunityColumns).single()
  if (result.error) throw databaseError(result.error)
  return result.data as Opportunity
}

export async function updateOpportunityStatus(client: SupabaseClient, opportunity: Opportunity, status: Opportunity['status']): Promise<Opportunity> {
  const result = await client.from('opportunities').update({ status, version: opportunity.version + 1 })
    .eq('id', opportunity.id).eq('version', opportunity.version).is('site_id', null).select(opportunityColumns).single()
  if (result.error?.code === 'PGRST116') throw new Error('机会已被其他设备更新，请刷新后重试')
  if (result.error) throw databaseError(result.error)
  return result.data as Opportunity
}

export async function promoteOpportunity(client: SupabaseClient, opportunity: Opportunity, name: string, dueOn: string): Promise<string> {
  if (!name.trim() || !dueOn) throw new Error('请填写新网站名称和首个行动日期')
  const result = await client.rpc('promote_opportunity', { p_opportunity_id: opportunity.id, p_expected_version: opportunity.version,
    p_site_name: name.trim(), p_first_due_on: dueOn })
  if (result.error) throw databaseError(result.error)
  return result.data as string
}

export async function confirmReport(client: SupabaseClient, draft: ReportDraft): Promise<string> {
  if ([draft.rawText, draft.completed, draft.evidence, draft.openItems, draft.nextStep].some((value) => !value.trim())) throw new Error('请补齐报告原文和预览字段')
  const result = await client.rpc('confirm_report', { p_report_id: draft.id, p_site_id: draft.siteId, p_expected_site_version: draft.siteVersion,
    p_raw_text: draft.rawText, p_completed: draft.completed, p_evidence: draft.evidence, p_open_items: draft.openItems,
    p_next_step: draft.nextStep, p_next_action_date: draft.nextActionDate, p_review_date: draft.reviewDate,
    p_source_url: draft.sourceUrl || null, p_observed_through: draft.observedThrough, p_finalized_through: draft.finalizedThrough || null })
  if (result.error) throw databaseError(result.error)
  return result.data as string
}

export async function appendSiteLog(client: SupabaseClient, draft: TimelineDraft): Promise<string> {
  if (!draft.text.trim() || !draft.nextAction.trim() || !draft.nextActionDate) throw new Error('请填写时间线原文、下一行动和日期')
  const result = await client.rpc('append_site_log', { p_site_id: draft.siteId, p_expected_version: draft.siteVersion,
    p_text: draft.text, p_source_url: draft.sourceUrl || null, p_next_action: draft.nextAction,
    p_next_action_date: draft.nextActionDate, p_observed_through: draft.observedThrough || null,
    p_finalized_through: draft.finalizedThrough || null })
  if (result.error) throw databaseError(result.error)
  return result.data as string
}

export async function routeCapture(client: SupabaseClient, capture: Capture, route: { kind: 'log'; siteId: string; text: string } | { kind: 'task'; siteId: string; title: string; dueOn: string } | { kind: 'opportunity'; fields: OpportunityFields }): Promise<string> {
  const base = { p_capture_id: capture.id, p_expected_version: capture.version }
  const name = route.kind === 'log' ? 'route_capture_to_log' : route.kind === 'task' ? 'route_capture_to_task' : 'route_capture_to_opportunity'
  const args = route.kind === 'log' ? { ...base, p_site_id: route.siteId, p_text: route.text }
    : route.kind === 'task' ? { ...base, p_site_id: route.siteId, p_title: route.title, p_due_on: route.dueOn }
      : { ...base, p_problem: route.fields.problem, p_evidence: route.fields.evidence, p_validation: route.fields.validation,
        p_scope: route.fields.scope, p_budget: route.fields.budget, p_pass_condition: route.fields.pass_condition,
        p_stop_condition: route.fields.stop_condition }
  const result = await client.rpc(name, args)
  if (result.error) throw databaseError(result.error)
  return result.data as string
}
