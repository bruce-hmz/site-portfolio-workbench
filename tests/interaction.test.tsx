import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { App } from '../src/App'
import { CaptureRouteForm, Opportunities, ReportPanel, SiteStrategyForm } from '../src/Flows'
import { createCapture, loadCaptureById, loadCaptureDestination, loadCompletedCapturePage, loadLogById, loadProfileTimezone, loadSiteLogPage, loadWorkspace, routeCapture, saveProfileTimezone, updateTask, type WorkspaceData } from '../src/lib/repository'
import { todayInTimeZone } from '../src/lib/dates'
import type { Capture, Log, Opportunity, Site, Task } from '../src/lib/types'

vi.mock('../src/lib/supabase', () => ({
  supabaseConfig: { isValid: true },
  supabase: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'user-a', email: 'a@example.test' } } } }),
    onAuthStateChange: () => ({ data: { listener: null, subscription: { unsubscribe() {} } } }),
    getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
  } },
}))
vi.mock('../src/lib/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/repository')>(),
  loadWorkspace: vi.fn(),
  loadProfileTimezone: vi.fn(),
  saveProfileTimezone: vi.fn(),
  createCapture: vi.fn(),
  routeCapture: vi.fn(),
  updateTask: vi.fn(),
  loadCompletedCapturePage: vi.fn(),
  loadCaptureById: vi.fn(),
  loadCaptureDestination: vi.fn(),
  loadLogById: vi.fn(),
  loadSiteLogPage: vi.fn(),
}))

const site: Site = {
  id: 'site-a', name: '测试网站', phase: '机会验证', strategy: '推进', current_goal: '验证需求',
  last_decision: '', next_action: '访谈', asset_links: '', next_checkpoint: '2026-10-01',
  strategy_condition: null, strategy_condition_due_on: null, archive_reason: null,
  updated_at: '2026-09-28T00:00:00Z', version: 1,
}
const workspace: WorkspaceData = { sites: [site], tasks: [], captures: [], logs: [], reports: [], opportunities: [] }

beforeEach(() => {
  vi.mocked(loadWorkspace).mockResolvedValue(workspace)
  vi.mocked(loadProfileTimezone).mockResolvedValue('Asia/Shanghai')
  vi.mocked(saveProfileTimezone).mockResolvedValue('Asia/Shanghai')
  vi.mocked(loadCompletedCapturePage).mockResolvedValue({ items: [], page: { offset: 0, nextOffset: null, total: 0, hasMore: false } })
  vi.mocked(loadCaptureById).mockResolvedValue(null)
  vi.mocked(loadCaptureDestination).mockResolvedValue({ kind: 'missing', id: 'capture-a' })
  vi.mocked(loadLogById).mockResolvedValue(null)
  vi.mocked(loadSiteLogPage).mockResolvedValue({ items: [], page: { offset: 0, nextOffset: null, total: 0, hasMore: false } })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function NavigateToSiteLog({ logId }: { logId: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(`/sites#log-${logId}`)}>打开另一条来源</button>
}

const task: Task = {
  id: 'task-a', site_id: 'site-a', title: '完成任务', type: '执行', due_on: '2020-01-01',
  status: '待处理', source: '手动', capture_id: null, version: 1,
}
const pendingCapture: Capture = {
  id: 'capture-focus', text: '一条待整理文字', status: '待整理', created_at: '2026-09-30T00:00:00Z', processed_at: null,
  destination_log_id: null, destination_task_id: null, destination_opportunity_id: null, version: 1,
}
const promotableOpportunity: Opportunity = {
  id: 'opportunity-focus', problem: '验证一个问题', evidence: '访谈证据', validation: '发起访谈', scope: '单页',
  budget: '一天', pass_condition: '有人预约', stop_condition: '无人回应', status: '通过', site_id: null,
  capture_id: null, version: 1,
}

describe('form state and conflicts', () => {
  it('keeps a report draft when focus triggers a background refresh', async () => {
    render(<MemoryRouter initialEntries={['/sites']}><App /></MemoryRouter>)
    const original = await screen.findByLabelText('原文')
    fireEvent.change(original, { target: { value: '尚未提交的报告' } })
    let resolveRefresh!: (value: WorkspaceData) => void
    vi.mocked(loadWorkspace).mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve }))
    fireEvent.focus(window)
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('尚未提交的报告')
    resolveRefresh({ ...workspace, sites: [{ ...site, version: 2 }] })
    await waitFor(() => expect(screen.getByText(/version 2/)).toBeTruthy())
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('尚未提交的报告')
  })

  it('keeps a capture draft across pages and after a failed save', async () => {
    vi.mocked(createCapture).mockRejectedValue(new Error('网络暂时不可用'))
    render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByText('+ 随手记'))
    fireEvent.change(screen.getByLabelText('原始文字'), { target: { value: '不能丢的想法' } })
    fireEvent.click(screen.getByRole('link', { name: /网站与详情/ }))
    await screen.findByText('新建网站')
    fireEvent.click(screen.getByRole('link', { name: /待整理/ }))
    fireEvent.click(await screen.findByText('+ 随手记'))
    expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('不能丢的想法')
    fireEvent.click(screen.getByRole('button', { name: '保存到待整理' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('不能丢的想法')
  })

  it('requires an explicit reload when the site version changes during strategy editing', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const view = render(<SiteStrategyForm site={site} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('当前策略'), { target: { value: '暂停' } })
    fireEvent.change(screen.getByLabelText('重启条件'), { target: { value: '草稿条件' } })
    view.rerender(<SiteStrategyForm site={{ ...site, version: 2, strategy: '观察', strategy_condition: '他处更新', strategy_condition_due_on: '2026-10-08' }} onSave={onSave} />)
    expect((screen.getByRole('button', { name: '保存策略' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('重启条件') as HTMLTextAreaElement).value).toBe('草稿条件')
    fireEvent.click(screen.getByText('载入最新策略'))
    expect((screen.getByLabelText('等待条件') as HTMLTextAreaElement).value).toBe('他处更新')
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }), '观察', '他处更新', '2026-10-08', ''))
  })

  it('confirms the edited source URL after report preview has been generated', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<ReportPanel site={site} onConfirm={onConfirm} />)
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: '完成：上线\n证据：用户反馈\n遗留：文案\n下一步：联系用户' } })
    fireEvent.click(screen.getByRole('button', { name: '生成提取预览' }))
    fireEvent.change(screen.getByLabelText('原始来源 URL（可选）'), { target: { value: 'https://example.test/new-source' } })
    fireEvent.click(screen.getByRole('button', { name: '确认回填' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://example.test/new-source', siteVersion: 1 })))
  })

  it('keeps a timezone draft after a failed save and applies it after success', async () => {
    vi.mocked(saveProfileTimezone).mockRejectedValueOnce(new Error('profile 写入失败')).mockResolvedValueOnce('Pacific/Kiritimati')
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    const timezone = await screen.findByLabelText('IANA 时区')
    fireEvent.change(timezone, { target: { value: 'Pacific/Kiritimati' } })
    fireEvent.click(screen.getByRole('button', { name: '保存时区' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('IANA 时区') as HTMLInputElement).value).toBe('Pacific/Kiritimati')
    fireEvent.click(screen.getByRole('button', { name: '保存时区' }))
    await waitFor(() => expect(screen.getByText(/时区已保存/)).toBeTruthy())
    expect(saveProfileTimezone).toHaveBeenCalledWith(expect.anything(), 'Pacific/Kiritimati')
  })

  it('waits for the persisted timezone before mounting date defaults', async () => {
    let resolveProfile!: (timezone: string) => void
    vi.mocked(loadProfileTimezone).mockReturnValueOnce(new Promise((resolve) => { resolveProfile = resolve }))
    render(<MemoryRouter initialEntries={['/sites']}><App /></MemoryRouter>)
    expect(screen.queryByLabelText('执行日期')).toBeNull()
    resolveProfile('America/Los_Angeles')
    const dueDate = await screen.findByLabelText('执行日期')
    expect((dueDate as HTMLInputElement).value).toBe(todayInTimeZone('America/Los_Angeles'))
  })

  it('keeps date editors hidden after the first profile failure and retries with the saved timezone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-29T01:00:00Z'))
    vi.mocked(loadProfileTimezone).mockRejectedValueOnce(new Error('profile unavailable')).mockResolvedValueOnce('America/Los_Angeles')
    render(<MemoryRouter initialEntries={['/sites']}><App /></MemoryRouter>)
    await screen.findByRole('alert')
    expect(screen.queryByLabelText('执行日期')).toBeNull()
    expect((screen.getByRole('button', { name: '保存时区' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }))
    const dueDate = await screen.findByLabelText('执行日期')
    expect((dueDate as HTMLInputElement).value).toBe('2026-09-28')
  })

  it('keeps a dirty timezone draft when focus refreshes the profile', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    const timezone = await screen.findByLabelText('IANA 时区')
    fireEvent.change(timezone, { target: { value: 'America/Los_Angeles' } })
    vi.mocked(loadWorkspace).mockResolvedValue(workspace)
    vi.mocked(loadProfileTimezone).mockResolvedValue('Asia/Shanghai')
    fireEvent.focus(window)
    await waitFor(() => expect(screen.getByLabelText('IANA 时区')).toBeTruthy())
    expect((screen.getByLabelText('IANA 时区') as HTMLInputElement).value).toBe('America/Los_Angeles')
  })
})

describe('task write races and deep links', () => {
  it('sends one write on a double click and disables both task controls while it is pending', async () => {
    const write = deferred<Task>()
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    vi.mocked(updateTask).mockReturnValue(write.promise)
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    const done = await screen.findByRole('button', { name: `完成任务：${task.title}` })
    fireEvent.click(done)
    fireEvent.click(done)

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: `完成任务：${task.title}` }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: `改期任务：${task.title}` }) as HTMLButtonElement).disabled).toBe(true)
    write.resolve({ ...task, status: '完成', version: 2 })
    await waitFor(() => expect(screen.queryByRole('button', { name: `完成任务：${task.title}` })).toBeNull())
  })

  it('releases the task lock after a failed write so the user can retry', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    vi.mocked(updateTask).mockRejectedValueOnce(new Error('temporary write failure')).mockResolvedValueOnce({ ...task, status: '完成', version: 2 })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: `完成任务：${task.title}` }))
    await screen.findByText('temporary write failure')
    const retry = await screen.findByRole('button', { name: `完成任务：${task.title}` })
    expect((retry as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByRole('button', { name: `完成任务：${task.title}` })).toBeNull())
    expect(updateTask).toHaveBeenCalledTimes(2)
  })

  it('does not let an older successful refresh restore the pre-write task', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    vi.mocked(updateTask).mockResolvedValue({ ...task, status: '完成', version: 2 })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await screen.findByRole('button', { name: `完成任务：${task.title}` })
    const staleRefresh = deferred<WorkspaceData>()
    vi.mocked(loadWorkspace).mockReturnValueOnce(staleRefresh.promise)
    fireEvent.focus(window)
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: `完成任务：${task.title}` }))
    await waitFor(() => expect(screen.queryByRole('button', { name: `完成任务：${task.title}` })).toBeNull())
    staleRefresh.resolve({ ...workspace, tasks: [task] })
    await waitFor(() => expect(screen.queryByRole('button', { name: `完成任务：${task.title}` })).toBeNull())
  })

  it('suppresses errors and loading state from a refresh invalidated by a successful write', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    vi.mocked(updateTask).mockResolvedValue({ ...task, status: '完成', version: 2 })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await screen.findByRole('button', { name: `完成任务：${task.title}` })
    const staleRefresh = deferred<WorkspaceData>()
    vi.mocked(loadWorkspace).mockReturnValueOnce(staleRefresh.promise)
    fireEvent.focus(window)
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: `完成任务：${task.title}` }))
    await waitFor(() => expect(screen.queryByRole('button', { name: `完成任务：${task.title}` })).toBeNull())
    staleRefresh.reject(new Error('stale read failure'))
    await waitFor(() => expect(screen.getByText(/云端数据/)).toBeTruthy())
    expect(screen.queryByText('stale read failure')).toBeNull()
  })

  it('loads an old capture target by id and resolves its completed task independently', async () => {
    const capture: Capture = {
      id: 'capture-old', text: '旧随手记', status: '已处理', created_at: '2026-01-01T00:00:00Z', processed_at: '2026-01-02T00:00:00Z',
      destination_log_id: null, destination_task_id: 'task-completed', destination_opportunity_id: null, version: 2,
    }
    const completedTask = { ...task, id: 'task-completed', status: '完成' as const }
    vi.mocked(loadCaptureById).mockResolvedValue(capture)
    vi.mocked(loadCaptureDestination).mockResolvedValue({ kind: 'task', task: completedTask })
    render(<MemoryRouter initialEntries={['/captures#capture-capture-old']}><App /></MemoryRouter>)

    expect(await screen.findByText('旧随手记')).toBeTruthy()
    const destination = await screen.findByRole('link', { name: '站点任务' })
    expect(destination.getAttribute('href')).toBe('/sites#site-site-a')
    expect(loadCaptureById).toHaveBeenCalledWith(expect.anything(), 'capture-old')
  })

  it('refreshes expanded processed history after organizing a capture and ignores its older in-flight page', async () => {
    const pendingCapture: Capture = {
      id: 'capture-route', text: '这段原文已整理', status: '待整理', created_at: '2026-09-29T00:00:00Z', processed_at: null,
      destination_log_id: null, destination_task_id: null, destination_opportunity_id: null, version: 1,
    }
    const processedCapture: Capture = {
      ...pendingCapture, status: '已处理', processed_at: '2026-09-30T00:00:00Z', destination_log_id: 'log-route', version: 2,
    }
    const destinationLog: Log = {
      id: 'log-route', site_id: site.id, text: '整理后的站点日志', source_type: 'manual', source_url: null,
      observed_through: null, finalized_through: null, collected_at: '2026-09-30T00:00:00Z', confirmed: true, capture_id: pendingCapture.id,
    }
    const staleHistoryPage = deferred<Awaited<ReturnType<typeof loadCompletedCapturePage>>>()
    const emptyHistoryPage = { items: [], page: { offset: 0, nextOffset: null, total: 0, hasMore: false } }
    vi.mocked(loadWorkspace)
      .mockResolvedValueOnce({ ...workspace, captures: [pendingCapture] })
      .mockResolvedValueOnce({ ...workspace, captures: [] })
    vi.mocked(loadCompletedCapturePage)
      .mockReturnValueOnce(staleHistoryPage.promise)
      .mockResolvedValueOnce({ items: [processedCapture], page: { offset: 0, nextOffset: null, total: 1, hasMore: false } })
    vi.mocked(routeCapture).mockResolvedValue(undefined)
    vi.mocked(loadCaptureDestination).mockResolvedValue({ kind: 'log', log: destinationLog })

    render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)
    await screen.findByText('这段原文已整理')
    fireEvent.click(screen.getByText('已处理随手记历史'))
    await waitFor(() => expect(loadCompletedCapturePage).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: `人工整理：${pendingCapture.text}` }))
    fireEvent.change(screen.getByLabelText('所属网站'), { target: { value: site.id } })
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    const destination = await screen.findByRole('link', { name: '站点日志' })
    expect(destination.getAttribute('href')).toBe('/sites#log-log-route')
    expect(screen.getByText('这段原文已整理')).toBeTruthy()
    expect(document.querySelectorAll('article.capture-card.processed')).toHaveLength(1)
    expect(routeCapture).toHaveBeenCalledWith(expect.anything(), pendingCapture, { kind: 'log', siteId: site.id, text: pendingCapture.text })
    expect(loadCompletedCapturePage).toHaveBeenCalledTimes(2)

    await act(async () => { staleHistoryPage.resolve(emptyHistoryPage) })
    expect(screen.getByRole('link', { name: '站点日志' })).toBeTruthy()
    expect(screen.getByText('这段原文已整理')).toBeTruthy()
  })

  it('refreshes expanded site history without a site version change and ignores the older page', async () => {
    const newLog: Log = {
      id: 'log-other-session', site_id: site.id, text: '另一会话新增的随手记日志', source_type: 'manual', source_url: null,
      observed_through: null, finalized_through: null, collected_at: '2026-09-30T00:00:00Z', confirmed: true, capture_id: 'capture-other-session',
    }
    const staleHistoryPage = deferred<Awaited<ReturnType<typeof loadSiteLogPage>>>()
    vi.mocked(loadSiteLogPage)
      .mockReturnValueOnce(staleHistoryPage.promise)
      .mockResolvedValueOnce({ items: [newLog], page: { offset: 0, nextOffset: null, total: 1, hasMore: false } })

    render(<MemoryRouter initialEntries={['/sites']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByText('策略、报告与来源记录'))
    await waitFor(() => expect(loadSiteLogPage).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: '尚未提交的报告草稿' } })
    expect(loadSiteLogPage).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }))

    expect(await screen.findByText(newLog.text)).toBeTruthy()
    expect(loadWorkspace).toHaveBeenCalledTimes(2)
    expect(loadSiteLogPage).toHaveBeenCalledTimes(2)
    expect(loadSiteLogPage).toHaveBeenLastCalledWith(expect.anything(), site.id, 0)
    expect(screen.getByText(/version 1/)).toBeTruthy()
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('尚未提交的报告草稿')
    expect((document.getElementById(`log-${newLog.id}`)?.closest('details') as HTMLDetailsElement).open).toBe(true)

    await act(async () => { staleHistoryPage.resolve({ items: [], page: { offset: 0, nextOffset: null, total: 0, hasMore: false } }) })
    expect(screen.getByText(newLog.text)).toBeTruthy()
    expect(screen.queryByText('正在读取来源记录…')).toBeNull()
  })

  it('asynchronously focuses a site-log deep link once and preserves an edited field through refresh', async () => {
    const log: Log = {
      id: 'log-a', site_id: site.id, text: '较早的来源记录', source_type: 'source', source_url: null,
      observed_through: '2026-09-20', finalized_through: null, collected_at: '2026-09-21T00:00:00Z', confirmed: true, capture_id: null,
    }
    const targetLog = deferred<Log>()
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, sites: [site], logs: [] })
    vi.mocked(loadLogById).mockReturnValue(targetLog.promise)
    render(<MemoryRouter initialEntries={['/sites#log-log-a']}><App /></MemoryRouter>)

    await waitFor(() => expect(loadLogById).toHaveBeenCalledWith(expect.anything(), 'log-a'))
    expect(screen.queryByText(log.text)).toBeNull()
    await act(async () => { targetLog.resolve(log) })
    expect(await screen.findByText('较早的来源记录')).toBeTruthy()
    await waitFor(() => expect((document.activeElement as HTMLElement).id).toBe('log-log-a'))
    expect(document.title).toBe('网站与详情 · 工作台')
    expect(document.activeElement).not.toBe(document.getElementById('page-title'))
    expect((document.getElementById('log-log-a')?.closest('details') as HTMLDetailsElement).open).toBe(true)

    const reportDraft = screen.getByLabelText('原文') as HTMLTextAreaElement
    reportDraft.focus()
    fireEvent.change(reportDraft, { target: { value: '用户正在编辑的报告草稿' } })
    fireEvent.focus(window)
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(loadSiteLogPage).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(reportDraft)
    expect(reportDraft.value).toBe('用户正在编辑的报告草稿')
  })

  it('focuses a newly navigated site-log hash after a previous target was consumed', async () => {
    const firstLog: Log = {
      id: 'log-first', site_id: site.id, text: '第一条来源', source_type: 'source', source_url: null,
      observed_through: null, finalized_through: null, collected_at: '2026-09-20T00:00:00Z', confirmed: true, capture_id: null,
    }
    const nextLog: Log = {
      ...firstLog, id: 'log-next', text: '新导航目标来源', collected_at: '2026-09-21T00:00:00Z',
    }
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, sites: [site], logs: [] })
    vi.mocked(loadLogById).mockImplementation(async (_client, logId) => logId === nextLog.id ? nextLog : firstLog)
    render(<MemoryRouter initialEntries={['/sites#log-log-first']}><App /><NavigateToSiteLog logId={nextLog.id} /></MemoryRouter>)

    await screen.findByText(firstLog.text)
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`log-${firstLog.id}`)))
    fireEvent.click(screen.getByRole('button', { name: '打开另一条来源' }))

    expect(await screen.findByText(nextLog.text)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`log-${nextLog.id}`)))
  })

  it('preserves quick-note editing focus when processed-capture history refreshes after its deep link', async () => {
    const capture: Capture = {
      id: 'capture-deep-link', text: '从历史打开的随手记', status: '已处理', created_at: '2026-09-21T00:00:00Z', processed_at: '2026-09-22T00:00:00Z',
      destination_log_id: null, destination_task_id: null, destination_opportunity_id: null, version: 2,
    }
    vi.mocked(loadCaptureById).mockResolvedValue(capture)
    render(<MemoryRouter initialEntries={[`/captures#capture-${capture.id}`]}><App /></MemoryRouter>)

    expect(await screen.findByText(capture.text)).toBeTruthy()
    const target = document.getElementById(`capture-${capture.id}`)
    await waitFor(() => expect(document.activeElement).toBe(target))
    await waitFor(() => expect(loadCompletedCapturePage).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '+ 随手记' }))
    const noteInput = screen.getByLabelText('原始文字') as HTMLTextAreaElement
    fireEvent.change(noteInput, { target: { value: '继续输入中的新随手记' } })
    expect(document.activeElement).toBe(noteInput)
    fireEvent.focus(window)
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(loadCompletedCapturePage).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(noteInput)
    expect(noteInput.value).toBe('继续输入中的新随手记')
  })

  it('focuses a pending-capture deep link and preserves its editor focus through refresh', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, captures: [pendingCapture] })
    render(<MemoryRouter initialEntries={[`/captures#capture-${pendingCapture.id}`]}><App /></MemoryRouter>)

    expect(await screen.findByText(pendingCapture.text)).toBeTruthy()
    const card = document.getElementById(`capture-${pendingCapture.id}`)
    await waitFor(() => expect(document.activeElement).toBe(card))

    fireEvent.click(screen.getByRole('button', { name: `人工整理：${pendingCapture.text}` }))
    const editor = screen.getByLabelText('整理说明') as HTMLTextAreaElement
    editor.focus()
    fireEvent.change(editor, { target: { value: '正在编辑的待整理说明' } })
    expect(document.activeElement).toBe(editor)
    fireEvent.focus(window)

    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(editor)
    expect(editor.value).toBe('正在编辑的待整理说明')
    expect(loadCaptureById).not.toHaveBeenCalled()
  })

  it('moves focus into the task date editor and restores it to the trigger on cancel', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    const trigger = await screen.findByRole('button', { name: `改期任务：${task.title}` })
    fireEvent.click(trigger)
    const date = await screen.findByLabelText(`新日期：${task.title}`)
    expect(document.activeElement).toBe(date)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `改期任务：${task.title}` })))
  })

  it('moves focus to the task-list heading when a successful reschedule removes its trigger', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({ ...workspace, tasks: [task] })
    vi.mocked(updateTask).mockResolvedValue({ ...task, due_on: '2099-01-01', status: '已改期', version: 2 })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: `改期任务：${task.title}` }))
    fireEvent.change(screen.getByLabelText(`新日期：${task.title}`), { target: { value: '2099-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: '确认改期' }))

    const heading = await screen.findByRole('heading', { name: '行动队列', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.queryByRole('button', { name: `改期任务：${task.title}` })).toBeNull()
  })

  it('focuses quick-note input on open, restores its trigger on cancel, and focuses the saved note action', async () => {
    const createdCapture: Capture = {
      ...pendingCapture, id: 'capture-created', text: '新写下的文字',
      created_at: '2026-09-30T01:00:00Z',
    }
    vi.mocked(createCapture).mockResolvedValue(createdCapture)
    render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)

    const trigger = await screen.findByRole('button', { name: '+ 随手记' })
    fireEvent.click(trigger)
    const input = await screen.findByLabelText('原始文字')
    expect(document.activeElement).toBe(input)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('原始文字'), { target: { value: createdCapture.text } })
    fireEvent.click(screen.getByRole('button', { name: '保存到待整理' }))
    const savedAction = await screen.findByRole('button', { name: `人工整理：${createdCapture.text}` })
    await waitFor(() => expect(document.activeElement).toBe(savedAction))
  })

  it('moves capture-route focus to the adjacent remaining item after the routed row disappears', async () => {
    const followingCapture: Capture = {
      ...pendingCapture, id: 'capture-next', text: '后续的随手记',
      created_at: '2026-09-29T00:00:00Z',
    }
    vi.mocked(loadWorkspace)
      .mockResolvedValueOnce({ ...workspace, captures: [pendingCapture, followingCapture] })
      .mockResolvedValueOnce({ ...workspace, captures: [followingCapture] })
    vi.mocked(routeCapture).mockResolvedValue(undefined)
    render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: `人工整理：${pendingCapture.text}` }))
    expect(document.activeElement).toBe(screen.getByLabelText('去向'))
    fireEvent.change(screen.getByLabelText('所属网站'), { target: { value: site.id } })
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    const followingAction = await screen.findByRole('button', { name: `人工整理：${followingCapture.text}` })
    await waitFor(() => expect(document.activeElement).toBe(followingAction))
  })

  it('focuses opportunity promotion on open, returns on cancel, and falls back to its card after promotion', async () => {
    let view: ReturnType<typeof render>
    const onPromote = vi.fn(async () => {
      view.rerender(<Opportunities opportunities={[{ ...promotableOpportunity, site_id: site.id }]} loading={false} timezone="Asia/Shanghai" onCreate={vi.fn()} onStatus={vi.fn()} onPromote={onPromote} />)
    })
    const onStatus = vi.fn().mockResolvedValue(undefined)
    view = render(<Opportunities opportunities={[promotableOpportunity]} loading={false} timezone="Asia/Shanghai" onCreate={vi.fn()} onStatus={onStatus} onPromote={onPromote} />)

    const trigger = screen.getByRole('button', { name: `转入网站：${promotableOpportunity.problem}` })
    fireEvent.click(trigger)
    const nameInput = screen.getByLabelText('新网站名称')
    expect(document.activeElement).toBe(nameInput)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '确认转入' }))
    const card = document.getElementById(`opportunity-${promotableOpportunity.id}`)
    await waitFor(() => expect(document.activeElement).toBe(card))
  })

  it('associates a raw-report validation error with its field only', () => {
    render(<ReportPanel site={site} onConfirm={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByRole('button', { name: '生成提取预览' }))

    const rawText = screen.getByLabelText('原文')
    const sourceUrl = screen.getByLabelText('原始来源 URL（可选）')
    expect(rawText.getAttribute('aria-invalid')).toBe('true')
    expect(rawText.getAttribute('aria-describedby')).toBe(`${rawText.id}-error`)
    expect(sourceUrl.hasAttribute('aria-invalid')).toBe(false)
    expect(sourceUrl.hasAttribute('aria-describedby')).toBe(false)
  })

  it('associates an empty quick-note validation error with its text field', async () => {
    render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '+ 随手记' }))
    const input = screen.getByLabelText('原始文字')
    fireEvent.submit(input.closest('form')!)

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('capture-input-error')
    expect(screen.getByRole('alert').id).toBe('capture-input-error')
  })
})
