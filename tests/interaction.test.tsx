import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'
import { ReportPanel, SiteStrategyForm } from '../src/Flows'
import { createCapture, loadProfileTimezone, loadWorkspace, saveProfileTimezone, type WorkspaceData } from '../src/lib/repository'
import { todayInTimeZone } from '../src/lib/dates'
import type { Site } from '../src/lib/types'

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
}))

const site: Site = {
  id: 'site-a', name: '测试网站', phase: '机会验证', strategy: '推进', current_goal: '验证需求',
  last_decision: '', next_action: '访谈', asset_links: '', next_checkpoint: '2026-10-01',
  strategy_condition: null, strategy_condition_due_on: null, archive_reason: null,
  updated_at: '2026-09-28T00:00:00Z', version: 1,
}
const workspace: WorkspaceData = { sites: [site], tasks: [], captures: [], logs: [], reports: [], opportunities: [] }

beforeEach(() => { vi.mocked(loadWorkspace).mockResolvedValue(workspace); vi.mocked(loadProfileTimezone).mockResolvedValue('Asia/Shanghai'); vi.mocked(saveProfileTimezone).mockResolvedValue('Asia/Shanghai') })
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers() })

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
