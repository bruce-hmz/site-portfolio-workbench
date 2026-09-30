import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'
import { ErrorBoundary } from '../src/ErrorBoundary'
import { loadProfileTimezone, loadWorkspace, type WorkspaceData } from '../src/lib/repository'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  listener: undefined as ((event: string, session: unknown) => void) | undefined,
}))

vi.mock('../src/lib/supabase', () => ({
  supabaseConfig: { isValid: true },
  supabase: { auth: authMocks },
}))

vi.mock('../src/lib/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/repository')>(),
  loadWorkspace: vi.fn(),
  loadProfileTimezone: vi.fn(),
}))

const emptyWorkspace: WorkspaceData = { sites: [], tasks: [], captures: [], logs: [], reports: [], opportunities: [] }

beforeEach(() => {
  authMocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
  authMocks.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    authMocks.listener = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  authMocks.signInWithOtp.mockResolvedValue({ data: {}, error: null })
  authMocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
  vi.mocked(loadWorkspace).mockResolvedValue(emptyWorkspace)
  vi.mocked(loadProfileTimezone).mockResolvedValue('Asia/Shanghai')
})

afterEach(() => { cleanup(); vi.resetAllMocks() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

describe('session recovery and login feedback', () => {
  it('offers retry when getSession returns an error', async () => {
    authMocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Failed to fetch' } })
    render(<MemoryRouter><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '登录状态恢复失败' })).toBeTruthy()
    expect(screen.getByText('网络连接失败，请检查网络后重试。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }))
    expect(await screen.findByLabelText('受邀邮箱')).toBeTruthy()
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)
  })

  it('offers retry when getSession rejects', async () => {
    authMocks.getSession.mockRejectedValueOnce({ message: 'network unavailable' })
    render(<MemoryRouter><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '登录状态恢复失败' })).toBeTruthy()
    expect(screen.getByText('网络连接失败，请检查网络后重试。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }))
    expect(await screen.findByLabelText('受邀邮箱')).toBeTruthy()
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer auth event when the earlier session restoration resolves late', async () => {
    const restoration = deferred<{ data: { session: null }; error: null }>()
    authMocks.getSession.mockReturnValueOnce(restoration.promise)
    render(<MemoryRouter><App /></MemoryRouter>)
    const session = { user: { id: 'user-a', email: 'a@example.test' } }

    authMocks.listener?.('SIGNED_IN', session)
    const chip = await screen.findByText((_text, element) => element?.classList.contains('sync-chip') ?? false)
    expect(chip.textContent).toContain('a@example.test')
    restoration.resolve({ data: { session: null }, error: null })
    expect(screen.queryByLabelText('受邀邮箱')).toBeNull()
    expect(document.querySelector('.sync-chip')?.textContent).toContain('a@example.test')
    await waitFor(() => expect(document.querySelector('.sync-chip')?.textContent).toContain('云端数据'))
  })

  it('blocks duplicate login submits and does not claim a server error sent email', async () => {
    const request = deferred<{ data: {}; error: { code: string; message: string; status: number } }>()
    authMocks.signInWithOtp.mockReturnValueOnce(request.promise)
    render(<MemoryRouter><App /></MemoryRouter>)
    const email = await screen.findByLabelText('受邀邮箱')
    fireEvent.change(email, { target: { value: 'a@example.test' } })
    const form = email.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(authMocks.signInWithOtp).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '处理中…' }) as HTMLButtonElement).disabled).toBe(true)
    request.resolve({ data: {}, error: { code: 'server_error', message: 'internal server error', status: 500 } })
    expect(await screen.findByText('登录暂时不可用，请稍后重试。')).toBeTruthy()
    expect(screen.queryByText('如果该邮箱已受邀，邮件中会有登录链接或验证码。')).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: '发送登录邮件' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('uses neutral feedback only for an explicit invite or signup restriction and confirms OTP success', async () => {
    authMocks.signInWithOtp.mockResolvedValueOnce({ data: {}, error: { code: 'signup_disabled', message: 'Signups not allowed for otp' } })
    authMocks.signInWithOtp.mockResolvedValueOnce({ data: {}, error: null })
    authMocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: null })
    render(<MemoryRouter><App /></MemoryRouter>)
    const email = await screen.findByLabelText('受邀邮箱')
    fireEvent.change(email, { target: { value: 'a@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录邮件' }))
    expect(await screen.findByText('如果该邮箱已受邀，邮件中会有登录链接或验证码。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '发送登录邮件' }))
    const code = await screen.findByLabelText('邮件验证码（可选）')
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '验证登录' }))
    expect(await screen.findByText('验证成功，正在进入工作台。')).toBeTruthy()
  })
})

describe('render error fallback', () => {
  it('renders the recovery screen after a child throws', () => {
    const originalError = console.error
    console.error = vi.fn()
    function BrokenPage(): never { throw new Error('render exploded') }
    try {
      render(<ErrorBoundary><BrokenPage /></ErrorBoundary>)
      expect(screen.getByRole('heading', { name: '页面暂时无法显示' })).toBeTruthy()
    } finally {
      console.error = originalError
    }
  })
})
