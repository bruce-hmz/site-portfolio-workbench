import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import axe from 'axe-core'
import { App } from '../src/App'
import { loadProfileTimezone, loadWorkspace, type WorkspaceData } from '../src/lib/repository'
import { todayInTimeZone } from '../src/lib/dates'
import type { Capture, Opportunity, Site, Task } from '../src/lib/types'

vi.mock('../src/lib/supabase', () => ({
  supabaseConfig: { isValid: true },
  supabase: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'user-a', email: 'a@example.test' } } } }),
    onAuthStateChange: () => ({ data: { listener: null, subscription: { unsubscribe() {} } } }),
  } },
}))

vi.mock('../src/lib/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/repository')>(),
  loadWorkspace: vi.fn(),
  loadProfileTimezone: vi.fn(),
}))

const site: Site = {
  id: 'site-a', name: '移动端验收网站', phase: 'MVP 开发', strategy: '推进', current_goal: '验证任务同源',
  last_decision: '', next_action: '查看任务', asset_links: '', next_checkpoint: todayInTimeZone('Asia/Shanghai'),
  strategy_condition: null, strategy_condition_due_on: null, archive_reason: null,
  updated_at: '2026-09-30T00:00:00Z', version: 1,
}
const secondSite: Site = { ...site, id: 'site-b', name: '第二移动端验收网站' }
const task: Task = {
  id: 'task-a', site_id: site.id, title: '生成本周计划', type: '执行', due_on: todayInTimeZone('Asia/Shanghai'),
  status: '待处理', source: '手动', capture_id: null, version: 1,
}
const capture: Capture = {
  id: 'capture-a', text: '核对这条需求', status: '待整理', created_at: '2026-09-30T00:00:00Z', processed_at: null,
  destination_log_id: null, destination_task_id: null, destination_opportunity_id: null, version: 1,
}
const opportunity: Opportunity = {
  id: 'opportunity-a', problem: '验证移动端需求', evidence: '用户访谈', validation: '邀请试用', scope: '一个页面',
  budget: '两天', pass_condition: '三人完成', stop_condition: '无人需要', status: '通过', site_id: null,
  capture_id: null, version: 1,
}
const fixture: WorkspaceData = {
  sites: [site, secondSite], tasks: [task], captures: [capture], logs: [], reports: [], opportunities: [opportunity],
}
const pages = [
  ['/', '今日工作台'],
  ['/sites', '网站与详情'],
  ['/calendar', '日历'],
  ['/opportunities', '新站计划池'],
  ['/captures', '待整理'],
] as const

beforeEach(() => {
  vi.mocked(loadWorkspace).mockResolvedValue(fixture)
  vi.mocked(loadProfileTimezone).mockResolvedValue('Asia/Shanghai')
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

async function scanA11y(container: HTMLElement) {
  const results = await axe.run(container, {
    // jsdom has no layout or rendered color information; contrast remains covered by tests/contrast.test.ts.
    rules: { 'color-contrast': { enabled: false } },
  })
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target),
  }))
  expect(violations).toEqual([])
}

describe('five-page accessibility smoke checks', () => {
  it('renders each page with its own title and current navigation link, then passes axe', async () => {
    for (const [path, title] of pages) {
      const view = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
      await screen.findByRole('heading', { level: 1, name: title })
      await waitFor(() => expect(document.title).toBe(`${title} · 工作台`))
      const navigation = screen.getByRole('navigation', { name: '主要导航' })
      expect(within(navigation).getByRole('link', { name: title }).getAttribute('aria-current')).toBe('page')

      if (path === '/') expect(screen.getByText(task.title)).toBeTruthy()
      if (path === '/sites') expect(screen.getByRole('heading', { name: site.name })).toBeTruthy()
      if (path === '/calendar') {
        const calendar = screen.getByRole('region', { name: '本周七日任务' })
        const days = calendar.querySelectorAll('section.day-column')
        expect(days).toHaveLength(7)
        expect(calendar.querySelectorAll('time[datetime]')).toHaveLength(7)
        expect(calendar.querySelectorAll('ol.calendar-task-list')).toHaveLength(7)
      }
      if (path === '/opportunities') expect(screen.getByText(opportunity.problem)).toBeTruthy()
      if (path === '/captures') expect(screen.getByText(capture.text)).toBeTruthy()

      await scanA11y(view.container)
      view.unmount()
    }
  })

  it('scrolls to and focuses main content from the skip link', async () => {
    const view = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1, name: '今日工作台' })
    const skipLink = screen.getByRole('link', { name: '跳到主要内容' })
    const main = view.container.querySelector('main')
    expect(main).toBeTruthy()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      fireEvent.click(skipLink)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(document.activeElement).toBe(main)
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })

  it('keeps the skip link and primary routes keyboard-focusable native links', async () => {
    const view = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    const skipLink = await screen.findByRole('link', { name: '跳到主要内容' })
    const navigation = screen.getByRole('navigation', { name: '主要导航' })
    const routeLink = within(navigation).getByRole('link', { name: '日历' })

    expect(view.container.querySelector('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).toBe(skipLink)
    expect(skipLink.tabIndex).toBe(0)
    skipLink.focus()
    expect(document.activeElement).toBe(skipLink)
    routeLink.focus()
    expect(document.activeElement).toBe(routeLink)
    expect(routeLink.tagName).toBe('A')
    expect(routeLink.getAttribute('href')).toBe('/calendar')
    expect(routeLink.getAttribute('aria-current')).toBeNull()
  })

  it('keeps keyboard focus and axe semantics when calendar edit, capture route, and opportunity promotion forms open', async () => {
    const calendarView = render(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
    const dateTrigger = await screen.findByRole('button', { name: `改期任务：${task.title}` })
    fireEvent.click(dateTrigger)
    const dateInput = screen.getByLabelText(`新日期：${task.title}`)
    expect(document.activeElement).toBe(dateInput)
    await scanA11y(calendarView.container)
    calendarView.unmount()

    const captureView = render(<MemoryRouter initialEntries={['/captures']}><App /></MemoryRouter>)
    const routeTrigger = await screen.findByRole('button', { name: `人工整理：${capture.text}` })
    fireEvent.click(routeTrigger)
    expect(document.activeElement).toBe(screen.getByLabelText('去向'))
    await scanA11y(captureView.container)
    captureView.unmount()

    const opportunityView = render(<MemoryRouter initialEntries={['/opportunities']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: `转入网站：${opportunity.problem}` }))
    expect(document.activeElement).toBe(screen.getByLabelText('新网站名称'))
    await scanA11y(opportunityView.container)
  })

  it('keeps report and timeline validation relationships unique across two expanded site cards', async () => {
    const view = render(<MemoryRouter initialEntries={['/sites']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: site.name })
    const cards = Array.from(view.container.querySelectorAll<HTMLElement>('.site-card'))
    expect(cards).toHaveLength(2)
    for (const card of cards) fireEvent.click(within(card).getByText('策略、报告与来源记录'))

    const reportPanels = cards.map((card) => card.querySelector<HTMLElement>('.report-panel')!)
    const reportInputIds: string[] = []
    const reportErrorIds: string[] = []
    for (const panel of reportPanels) {
      const rawText = within(panel).getByLabelText('原文')
      fireEvent.click(within(panel).getByRole('button', { name: '生成提取预览' }))
      const rawErrorId = rawText.getAttribute('aria-describedby')!
      reportInputIds.push(rawText.id)
      reportErrorIds.push(rawErrorId)
      expect(rawText.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(rawErrorId)?.closest('.report-panel')).toBe(panel)

      fireEvent.change(rawText, { target: { value: '完成：上线\n证据：访谈\n遗留：文案\n下一步：联系用户' } })
      fireEvent.click(within(panel).getByRole('button', { name: '生成提取预览' }))
      const sourceUrl = within(panel).getByLabelText('原始来源 URL（可选）')
      fireEvent.change(sourceUrl, { target: { value: 'javascript:alert(1)' } })
      fireEvent.submit(panel.querySelector('form.preview-form')!)
      const sourceErrorId = sourceUrl.getAttribute('aria-describedby')!
      reportInputIds.push(sourceUrl.id)
      reportErrorIds.push(sourceErrorId)
      expect(sourceUrl.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(sourceErrorId)?.closest('.report-panel')).toBe(panel)
    }
    expect(new Set(reportInputIds).size).toBe(reportInputIds.length)
    expect(new Set(reportErrorIds).size).toBe(reportErrorIds.length)

    const timelineInputs = cards.map((card) => card.querySelector<HTMLInputElement>('input[id^="timeline-source-url-"]')!)
    const timelineInputIds: string[] = []
    const timelineErrorIds: string[] = []
    for (const sourceUrl of timelineInputs) {
      fireEvent.change(sourceUrl, { target: { value: 'javascript:alert(1)' } })
      fireEvent.submit(sourceUrl.closest('form')!)
      const errorId = sourceUrl.getAttribute('aria-describedby')!
      timelineInputIds.push(sourceUrl.id)
      timelineErrorIds.push(errorId)
      expect(sourceUrl.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(errorId)?.closest('form')).toBe(sourceUrl.closest('form'))
    }
    expect(new Set(timelineInputIds).size).toBe(timelineInputIds.length)
    expect(new Set(timelineErrorIds).size).toBe(timelineErrorIds.length)
    await scanA11y(view.container)
  })
})
