import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { appendSiteLog, confirmReport, createCapture, createOpportunity, createSite, createTask, loadLogById, loadProfileTimezone, loadWorkspace, promoteOpportunity, routeCapture, saveProfileTimezone, updateOpportunityStatus, updateSiteContext, updateSiteStrategy, updateTask, type OpportunityFields, type SiteContextFields, type WorkspaceData } from './lib/repository'
import { supabase, supabaseConfig } from './lib/supabase'
import { authErrorMessage, authRequestMessage } from './lib/authErrors'
import { addDateDays, DEFAULT_TIMEZONE, formatDateOnly, startOfWeekInTimeZone, todayInTimeZone, weekdayForDateOnly } from './lib/dates'
import type { Capture, Log, Opportunity, Report, ReportDraft, Site, Task, TimelineDraft } from './lib/types'
import { CaptureRouteForm, Opportunities, ReportPanel, SiteContextForm, SiteStrategyForm, TimelineForm } from './Flows'
import { ProcessedCaptureHistory } from './components/ProcessedCaptureHistory'
import { SiteLogHistory } from './components/SiteLogHistory'
import type { SupabaseClient } from '@supabase/supabase-js'

const emptyData: WorkspaceData = { sites: [], tasks: [], captures: [], opportunities: [], logs: [], reports: [] }
const navItems = [
  ['/', '01', '今日工作台'], ['/sites', '02', '网站与详情'], ['/calendar', '03', '日历'], ['/opportunities', '04', '新站计划池'], ['/captures', '05', '待整理'],
] as const

function formatDate(value: string | null, timeZone: string) { return formatDateOnly(value, timeZone) }

function isHttpUrl(value: string | null): value is string {
  if (!value) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) }
  catch { return false }
}

function RecordFocus({ loading }: { loading: boolean }) {
  const location = useLocation()
  const focusIntentRef = useRef('')
  const focusConsumedRef = useRef(false)
  useEffect(() => {
    const focusIntent = `${location.key}:${location.pathname}:${location.hash}`
    if (focusIntentRef.current !== focusIntent) {
      focusIntentRef.current = focusIntent
      focusConsumedRef.current = false
    }
    if (focusConsumedRef.current || loading || !/^#(?:site|capture|opportunity)-/.test(location.hash)) return
    const target = document.getElementById(location.hash.slice(1))
    if (!target) return
    if (location.hash.startsWith('#capture-') && target.closest('.capture-card.processed')) return
    const details = target.closest('details')
    if (details) details.open = true
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
    if (document.activeElement === target) focusConsumedRef.current = true
  }, [location.key, location.pathname, location.hash, loading])
  return null
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; busyRef.current = false }
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current || !supabase) return
    busyRef.current = true
    setBusy(true); setError(''); setMessage('')
    try {
      const result = code.trim()
        ? await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
        : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } })
      if (!mountedRef.current) return
      if (result.error) setError(authRequestMessage(result.error))
      else if (code.trim()) { setSent(true); setMessage('验证成功，正在进入工作台。') }
      else { setSent(true); setMessage('如果该邮箱已受邀，邮件中会有登录链接或验证码。') }
    } catch (err) { if (mountedRef.current) setError(authRequestMessage(err)) }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(false) }
  }
  return <main className="auth-shell"><section className="auth-card">
    <span className="eyebrow">SITE PORTFOLIO WORKBENCH</span><h1>把下次开工放回上下文</h1>
    {!supabaseConfig.isValid ? <div className="config-error" role="alert"><strong>Supabase 配置缺失</strong><p>请配置 <code>VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> 后重新启动。当前不会加载或伪造任何云端数据。</p></div> : <>
      <p className="lede">生产版本只接受已邀请的邮箱账号。输入邮箱获取 magic link，也可以粘贴邮件中的 OTP。</p>
      <form onSubmit={submit} className="stack-form"><label>受邀邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        {sent && <label>邮件验证码（可选）<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴 OTP 后再次提交" /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? '处理中…' : code ? '验证登录' : '发送登录邮件'}</button>
      </form>
    </>}
  </section></main>
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabaseConfig.isValid)
  const [authError, setAuthError] = useState('')
  const [authAttempt, setAuthAttempt] = useState(0)
  useEffect(() => {
    if (!supabase) return
    let active = true
    let authEventVersion = 0
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventVersion += 1
      if (active) { setAuthError(''); setSession(nextSession); setReady(true) }
    })
    const requestVersion = authEventVersion
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || requestVersion !== authEventVersion) return
      if (error) { setAuthError(authErrorMessage(error, '无法恢复登录状态，请重试。')); setReady(true); return }
      setSession(data.session); setReady(true)
    }).catch((error: unknown) => {
      if (active && requestVersion === authEventVersion) { setAuthError(authErrorMessage(error, '无法恢复登录状态，请重试。')); setReady(true) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [authAttempt])
  if (!ready) return <main className="auth-shell"><p>正在恢复登录状态…</p></main>
  if (authError) return <main className="auth-shell"><section className="auth-card" role="alert"><h1>登录状态恢复失败</h1><p className="form-error">{authError}</p><button className="primary-button" onClick={() => { setAuthError(''); setReady(false); setAuthAttempt((attempt) => attempt + 1) }}>重新尝试</button></section></main>
  if (!session) return <LoginPage />
  return <Workspace key={session.user.id} session={session} />
}

function Workspace({ session }: { session: Session }) {
  const location = useLocation()
  const pageTitle = navItems.find(([path]) => path === location.pathname)?.[2] ?? navItems[0][2]
  const mainRef = useRef<HTMLElement | null>(null)
  const [data, setData] = useState(emptyData)
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [profileReady, setProfileReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captureDraft, setCaptureDraft] = useState('')
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0)
  const mountedRef = useRef(true)
  const refreshSequenceRef = useRef(0)
  const mutationSequenceRef = useRef(0)
  const taskInFlightRef = useRef(new Set<string>())
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    document.title = `${pageTitle} · 工作台`
    if (location.hash) return
    document.getElementById('page-title')?.focus({ preventScroll: true })
  }, [location.pathname, location.hash, pageTitle])
  const invalidateRefreshes = () => {
    mutationSequenceRef.current += 1
    if (mountedRef.current) { setLoading(false); setError('') }
  }
  const refresh = useCallback(async () => {
    if (!supabase || !mountedRef.current) return
    const sequence = ++refreshSequenceRef.current
    const mutationSequence = mutationSequenceRef.current
    if (mountedRef.current) { setLoading(true); setError('') }
    try {
      const [workspace, profileTimezone] = await Promise.all([loadWorkspace(supabase), loadProfileTimezone(supabase)])
      if (!mountedRef.current || sequence !== refreshSequenceRef.current || mutationSequence !== mutationSequenceRef.current) return
      setData(workspace); setTimezone(profileTimezone); setProfileReady(true); setWorkspaceRefreshVersion((version) => version + 1)
    } catch (err) {
      if (mountedRef.current && sequence === refreshSequenceRef.current && mutationSequence === mutationSequenceRef.current) setError(err instanceof Error ? err.message : '读取云端数据失败')
    } finally {
      if (mountedRef.current && sequence === refreshSequenceRef.current && mutationSequence === mutationSequenceRef.current) setLoading(false)
    }
  }, [])
  useEffect(() => { mountedRef.current = true; void refresh(); const onFocus = () => void refresh(); window.addEventListener('focus', onFocus); return () => { mountedRef.current = false; window.removeEventListener('focus', onFocus) } }, [refresh])
  const mutateTask = async (task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>) => {
    if (!supabase || taskInFlightRef.current.has(task.id)) return false
    taskInFlightRef.current.add(task.id); setPendingTaskIds((current) => new Set(current).add(task.id))
    try {
      const updated = await updateTask(supabase, task, patch)
      invalidateRefreshes()
      if (mountedRef.current) { setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? updated : item) })); setNotice('任务已更新，日历同步来自同一条任务记录。') }
      return true
    } catch (err) {
      const message = err instanceof Error && err.message === 'STALE_CONFLICT' ? '其他设备已更新这条任务，请重新加载后再操作。' : err instanceof Error ? err.message : '任务更新失败'
      await refresh()
      if (mountedRef.current) setError(message)
      return false
    } finally {
      taskInFlightRef.current.delete(task.id)
      if (mountedRef.current) setPendingTaskIds((current) => { const next = new Set(current); next.delete(task.id); return next })
    }
  }
  const addCapture = async (text: string) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const capture = await createCapture(supabase, text)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, captures: [capture, ...current.captures] }))
    setNotice('文字已保存到待整理。')
  }
  const addSite = async (name: string) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const site = await createSite(supabase, name)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, sites: [site, ...current.sites] }))
    setNotice('网站已保存。')
  }
  const addTask = async (siteId: string, title: string, dueOn: string) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const task = await createTask(supabase, siteId, title, dueOn)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, tasks: [...current.tasks, task] }))
    setNotice('任务已保存，日历会从同一条记录显示。')
  }
  const saveStrategy = async (site: Site, strategy: string, condition: string, dueOn: string, archiveReason: string) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    await updateSiteStrategy(supabase, site, strategy, condition, dueOn, archiveReason)
    if (!mountedRef.current) return
    invalidateRefreshes()
    await refresh()
    if (mountedRef.current) setNotice('网站策略已保存。')
  }
  const saveSiteContext = async (site: Site, fields: SiteContextFields) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const updated = await updateSiteContext(supabase, site, fields)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, sites: current.sites.map((item) => item.id === site.id ? updated : item) }))
    setNotice('网站资料已保存。')
  }
  const saveReport = async (draft: ReportDraft) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    await confirmReport(supabase, draft)
    if (!mountedRef.current) return
    invalidateRefreshes()
    await refresh()
    if (mountedRef.current) setNotice('报告已确认，网站、日志和任务已一并更新。')
  }
  const saveTimeline = async (draft: TimelineDraft) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    await appendSiteLog(supabase, draft)
    if (!mountedRef.current) return
    invalidateRefreshes()
    await refresh()
    if (mountedRef.current) setNotice('时间线、下一行动和执行任务已一并保存。')
  }
  const addOpportunity = async (fields: OpportunityFields) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const opportunity = await createOpportunity(supabase, fields)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, opportunities: [opportunity, ...current.opportunities] }))
    setNotice('机会已保存。')
  }
  const changeOpportunityStatus = async (opportunity: Opportunity, status: Opportunity['status']) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    const updated = await updateOpportunityStatus(supabase, opportunity, status)
    if (!mountedRef.current) return
    invalidateRefreshes()
    setData((current) => ({ ...current, opportunities: current.opportunities.map((item) => item.id === opportunity.id ? updated : item) }))
  }
  const turnOpportunityIntoSite = async (opportunity: Opportunity, name: string, dueOn: string) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    await promoteOpportunity(supabase, opportunity, name, dueOn)
    if (!mountedRef.current) return
    invalidateRefreshes()
    await refresh()
    if (mountedRef.current) setNotice('机会已转入网站，首个任务已进入日历。')
  }
  const organizeCapture = async (capture: Capture, route: Parameters<typeof routeCapture>[2]) => {
    if (!supabase) throw new Error('Supabase 配置缺失')
    await routeCapture(supabase, capture, route)
    if (!mountedRef.current) return
    invalidateRefreshes()
    await refresh()
    if (mountedRef.current) setNotice('随手记已整理，原始文字仍保留。')
  }
  const saveTimezone = async (draft: string) => { const saved = await saveProfileTimezone(supabase!, draft); invalidateRefreshes(); if (mountedRef.current) { setTimezone(saved); setNotice('时区已保存，今天、日历和日期默认值已同步。') } }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); const main = mainRef.current; if (!main) return; main.scrollIntoView?.({ block: 'start' }); main.focus({ preventScroll: true }) }}>跳到主要内容</a>
    <Sidebar session={session} timezone={timezone} profileReady={profileReady} onTimezone={saveTimezone} /><main id="main-content" ref={mainRef} tabIndex={-1} aria-busy={loading || !profileReady} className="main-content">
    <header className="topbar"><div><span className="eyebrow">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeZone: timezone }).format(new Date())}</span><h1 id="page-title" tabIndex={-1}>{pageTitle}</h1></div><span className="sync-chip" aria-live="polite" aria-atomic="true">{loading ? '正在同步' : error ? '同步失败' : '云端数据'} · {session.user.email}</span><button className="small-button" disabled={loading} onClick={() => void refresh()}>刷新数据</button></header>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
    {!profileReady ? <div className="empty-state">正在读取账号日期设置…</div> : <><RecordFocus loading={loading} /><Routes><Route path="/" element={<Dashboard data={data} loading={loading} timezone={timezone} onTask={mutateTask} pendingTaskIds={pendingTaskIds} />} /><Route path="/sites" element={<Sites client={supabase!} data={data} loading={loading} timezone={timezone} workspaceRefreshVersion={workspaceRefreshVersion} onCreateSite={addSite} onCreateTask={addTask} onContext={saveSiteContext} onStrategy={saveStrategy} onReport={saveReport} onTimeline={saveTimeline} />} /><Route path="/calendar" element={<Calendar data={data} loading={loading} timezone={timezone} onTask={mutateTask} pendingTaskIds={pendingTaskIds} />} /><Route path="/opportunities" element={<Opportunities opportunities={data.opportunities} loading={loading} timezone={timezone} onCreate={addOpportunity} onStatus={changeOpportunityStatus} onPromote={turnOpportunityIntoSite} />} /><Route path="/captures" element={<Captures client={supabase!} text={captureDraft} setText={setCaptureDraft} captures={data.captures} sites={data.sites} loading={loading} timezone={timezone} workspaceRefreshVersion={workspaceRefreshVersion} onCreate={addCapture} onRoute={organizeCapture} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></>}
  </main></div>
}

function Sidebar({ session, timezone, profileReady, onTimezone }: { session: Session; timezone: string; profileReady: boolean; onTimezone: (timezone: string) => Promise<void> }) {
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 901px)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const viewport = window.matchMedia('(min-width: 901px)')
    const updateSettings = () => setSettingsOpen(viewport.matches)
    viewport.addEventListener?.('change', updateSettings)
    return () => viewport.removeEventListener?.('change', updateSettings)
  }, [])
  return <aside className="sidebar" aria-label="工作台导航与账号设置"><div className="brand"><span className="brand-mark" aria-hidden="true">/</span><div><strong>工作台</strong><small>站点组合 · 生产版</small></div></div><nav className="nav-list" aria-label="主要导航">{navItems.map(([path, number, label]) => <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to={path} end={path === '/'} key={path}><span aria-hidden="true">{number}</span>{label}</NavLink>)}</nav><details className="sidebar-settings" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}><summary>日期与账号设置</summary><TimezoneSettings timezone={timezone} profileReady={profileReady} onSave={onTimezone} /><div className="sidebar-note"><span className="eyebrow">账号</span><p>{session.user.email}</p><small>invite-only · owner 隔离</small></div><button className="reset-button" onClick={async () => { await supabase?.auth.signOut(); navigate('/') }}>退出登录</button></details></aside>
}

function TimezoneSettings({ timezone, profileReady, onSave }: { timezone: string; profileReady: boolean; onSave: (timezone: string) => Promise<void> }) {
  const [draft, setDraft] = useState(timezone)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!dirtyRef.current) setDraft(timezone) }, [timezone])
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setSaving(true); try { await onSave(draft.trim()); dirtyRef.current = false; setDirty(false) } catch (err) { setError(err instanceof Error ? err.message : '时区保存失败') } finally { setSaving(false) } }
  return <form className="timezone-settings" onSubmit={submit}><span className="eyebrow">日期时区</span><input aria-label="IANA 时区" disabled={!profileReady || saving} value={draft} onChange={(event) => { dirtyRef.current = true; setDraft(event.target.value); setDirty(true) }} placeholder="Asia/Shanghai" /><button className="small-button" disabled={!profileReady || saving || !dirty}>保存时区</button>{error && <small className="form-error" role="alert">{error}</small>}</form>
}

function LoadingOrEmpty({ loading, children, empty = '暂无云端数据。', count }: { loading: boolean; children: React.ReactNode; empty?: string; count: number }) { return loading && !count ? <div className="empty-state" aria-live="polite" aria-busy={loading}>正在读取云端数据…</div> : count ? children : <div className="empty-state" aria-busy={loading}>{empty}</div> }

function Dashboard({ data, loading, timezone, onTask, pendingTaskIds }: { data: WorkspaceData; loading: boolean; timezone: string; onTask: (task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>) => Promise<boolean>; pendingTaskIds: Set<string> }) {
  const siteById = new Map(data.sites.map((site) => [site.id, site]))
  const today = todayInTimeZone(timezone)
  const pending = data.tasks.filter((task) => task.status !== '完成' && task.due_on <= today)
  const waiting = data.sites.filter((site) => ['观察', '暂停'].includes(site.strategy))
  return <section className="page" aria-busy={loading}>
    <div className="intro-row"><div><span className="eyebrow">今日节奏</span><h2>今天要做什么</h2><p className="lede">数据来自当前登录账号的 Supabase 项目。</p></div></div>
    <div className="metric-strip"><div><span>今日待办</span><strong>{pending.length}</strong></div><div><span>等待条件</span><strong>{waiting.length}</strong></div><div><span>站点</span><strong>{data.sites.length}</strong></div><div className="metric-accent"><span>待整理文字</span><strong>{data.captures.filter((capture) => capture.status === '待整理').length}</strong></div></div>
    <div className="content-grid">
      <div className="panel">
        <div className="panel-heading"><div><span className="eyebrow">下一步</span><h3 tabIndex={-1}>行动队列</h3></div><span className="count-label">{pending.length} 项</span></div>
        <LoadingOrEmpty loading={loading} count={pending.length} empty="今天没有排定任务。">
          <div className="task-list">{pending.map((task) => <TaskRow key={task.id} task={task} site={siteById.get(task.site_id)} timezone={timezone} onTask={onTask} pending={pendingTaskIds.has(task.id)} />)}</div>
        </LoadingOrEmpty>
      </div>
      <div className="panel">
        <div className="panel-heading"><div><span className="eyebrow">需要条件</span><h3>等待与风险</h3></div></div>
        <LoadingOrEmpty loading={loading} count={waiting.length} empty="目前没有等待条件。">
          <div>{waiting.map((site) => <div className="waiting-item" key={site.id}><strong>{site.name}</strong><p>{site.strategy} · {site.next_checkpoint ? `检查于 ${formatDate(site.next_checkpoint, timezone)}` : '需要补充检查日期'}</p></div>)}</div>
        </LoadingOrEmpty>
      </div>
    </div>
  </section>
}
function TaskRow({ task, site, timezone, onTask, pending }: { task: Task; site?: Site; timezone: string; onTask: (task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>) => Promise<boolean>; pending: boolean }) {
  return <div className="task-row"><i className="task-marker" aria-hidden="true" /><div><Link className="task-title-link" to={`/sites#site-${task.site_id}`}>{task.title}</Link><div className="task-meta">{site?.name ?? '异常：站点不存在'} · {task.type} · {formatDate(task.due_on, timezone)}{task.capture_id && <Link to={`/captures#capture-${task.capture_id}`}> · 原始随手记</Link>}</div></div><div className="task-actions"><button className="small-button" aria-label={`完成任务：${task.title}`} disabled={pending} onClick={() => void onTask(task, { status: '完成' })}>完成</button><TaskDateControl task={task} onTask={onTask} pending={pending} /></div></div>
}

function TaskDateControl({ task, onTask, pending }: { task: Task; onTask: (task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>) => Promise<boolean>; pending: boolean }) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(task.due_on)
  const [baseTask, setBaseTask] = useState(task)
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const focusFallbackRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(false)
  useEffect(() => {
    if (editing) dateInputRef.current?.focus()
    else if (restoreFocusRef.current && !pending) {
      const focusTarget = triggerRef.current?.isConnected ? triggerRef.current : focusFallbackRef.current
      focusTarget?.focus({ preventScroll: true })
      restoreFocusRef.current = false
    }
  }, [editing, pending])
  const closeEditor = () => { restoreFocusRef.current = true; setEditing(false) }
  const openEditor = () => {
    const trigger = triggerRef.current
    focusFallbackRef.current = trigger?.closest('.day-column')?.querySelector<HTMLElement>('h3')
      ?? trigger?.closest('.task-list')?.closest('.panel')?.querySelector<HTMLElement>('.panel-heading h3')
      ?? document.getElementById('page-title')
    setDate(task.due_on); setBaseTask(task); setEditing(true)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (date === baseTask.due_on) { closeEditor(); return }
    setSaving(true)
    try {
      if (await onTask(baseTask, { due_on: date, status: '已改期' })) {
        if (!triggerRef.current?.isConnected) focusFallbackRef.current?.focus({ preventScroll: true })
        closeEditor()
      }
    }
    finally { setSaving(false) }
  }
  if (!editing) return <button ref={triggerRef} className="small-button" aria-label={`改期任务：${task.title}`} disabled={pending} onClick={openEditor}>改期</button>
  return <form className="date-control" onSubmit={submit}>
    <input ref={dateInputRef} aria-label={`新日期：${task.title}`} type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
    {baseTask.version !== task.version && <span>任务已有更新。<button type="button" className="small-button" onClick={() => { setDate(task.due_on); setBaseTask(task) }}>载入最新日期</button></span>}
    <button className="small-button" type="submit" disabled={saving || pending}>确认改期</button><button className="small-button" type="button" disabled={saving || pending} onClick={closeEditor}>取消</button>
  </form>
}

function Sites({ client, data, loading, timezone, workspaceRefreshVersion, onCreateSite, onCreateTask, onContext, onStrategy, onReport, onTimeline }: {
  client: SupabaseClient
  data: WorkspaceData
  loading: boolean
  timezone: string
  workspaceRefreshVersion: number
  onCreateSite: (name: string) => Promise<void>
  onCreateTask: (siteId: string, title: string, dueOn: string) => Promise<void>
  onContext: (site: Site, fields: SiteContextFields) => Promise<void>
  onStrategy: (site: Site, strategy: string, condition: string, dueOn: string, archiveReason: string) => Promise<void>
  onReport: (draft: ReportDraft) => Promise<void>
  onTimeline: (draft: TimelineDraft) => Promise<void>
}) {
  const location = useLocation()
  const targetLogId = location.pathname === '/sites' ? location.hash.match(/^#log-(.+)$/)?.[1] ?? null : null
  const [targetLog, setTargetLog] = useState<Log | null>(null)
  const [targetLogError, setTargetLogError] = useState('')
  const [name, setName] = useState('')
  const [siteId, setSiteId] = useState('')
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState(todayInTimeZone(timezone))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    setTargetLog(null)
    setTargetLogError('')
    if (!targetLogId) return () => { active = false }
    void loadLogById(client, targetLogId).then((log) => {
      if (!active) return
      if (log) setTargetLog(log)
      else setTargetLogError('此来源记录不存在，或当前账号无权访问。')
    }).catch((reason: unknown) => {
      if (active) setTargetLogError(reason instanceof Error ? reason.message : '读取目标来源记录失败')
    })
    return () => { active = false }
  }, [client, targetLogId])
  const submitSite = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onCreateSite(name); setName('') }
    catch (err) { setError(err instanceof Error ? err.message : '网站保存失败') }
    finally { setSaving(false) }
  }
  const submitTask = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onCreateTask(siteId, title, dueOn); setTitle('') }
    catch (err) { setError(err instanceof Error ? err.message : '任务保存失败') }
    finally { setSaving(false) }
  }
  return <section className="page" aria-busy={loading}><div className="intro-row"><div><span className="eyebrow">站点组合</span><h2>网站与详情</h2><p className="lede">先建立站点，再把下一行动排入同源任务日历。</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {targetLogError && <p className="form-error" role="alert">{targetLogError}</p>}
    <div className="content-grid creation-grid"><form className="panel stack-form" onSubmit={submitSite}><h3>新建网站</h3><label>网站名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" disabled={saving}>保存网站</button></form>
      <form className="panel stack-form" onSubmit={submitTask}><h3>安排执行任务</h3><label>所属网站<select required value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">请选择</option>{data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>任务标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>执行日期<input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label><button className="primary-button" disabled={saving || !data.sites.length}>保存任务</button></form></div>
    {loading && !data.sites.length ? <div className="empty-state">正在读取云端数据…</div> : data.sites.length ? <div className="site-grid">{data.sites.map((site) => <SiteCard key={site.id} client={client} site={site} logs={data.logs.filter((log) => log.site_id === site.id)} reports={data.reports.filter((report) => report.site_id === site.id)} targetLogId={targetLogId} targetLog={targetLog?.id === targetLogId && targetLog.site_id === site.id ? targetLog : null} focusIntent={`${location.key}:${location.hash}`} timezone={timezone} workspaceRefreshVersion={workspaceRefreshVersion} onContext={onContext} onStrategy={onStrategy} onReport={onReport} onTimeline={onTimeline} />)}</div> : <div className="empty-state">还没有属于当前账号的站点。</div>}
  </section>
}

function SiteCard({ client, site, logs, reports, targetLogId, targetLog, focusIntent, timezone, workspaceRefreshVersion, onContext, onStrategy, onReport, onTimeline }: {
  client: SupabaseClient
  site: Site
  logs: Log[]
  reports: Report[]
  targetLogId: string | null
  targetLog: Log | null
  focusIntent: string
  timezone: string
  workspaceRefreshVersion: number
  onContext: (site: Site, fields: SiteContextFields) => Promise<void>
  onStrategy: (site: Site, strategy: string, condition: string, dueOn: string, archiveReason: string) => Promise<void>
  onReport: (draft: ReportDraft) => Promise<void>
  onTimeline: (draft: TimelineDraft) => Promise<void>
}) {
  const [handoffVisible, setHandoffVisible] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => { if (targetLog) setDetailsOpen(true) }, [targetLog])
  const latestLog = logs.find((log) => log.observed_through !== null)
  const latestReport = reports[0]
  const needsRefresh = latestLog && Date.now() - new Date(latestLog.collected_at).getTime() > 14 * 86400000
  const handoff = `【${site.name} · 交接包】\n阶段：${site.phase}｜策略：${site.strategy}\n最近决策：${site.last_decision || '未填写'}\n下一行动：${site.next_action || '未填写'}\n检查点：${site.next_checkpoint || '未设置'}\n遗留：${latestReport?.open_items || '暂无'}\n来源：${latestReport?.source_url || latestLog?.source_url || '暂无'}`
  const copyHandoff = async () => {
    try { await navigator.clipboard.writeText(handoff); setCopyMessage('已复制') }
    catch { setCopyMessage('无法自动复制，请选择下方文字手动复制') }
  }
  return <article className="site-card" id={`site-${site.id}`} tabIndex={-1}><div className="card-top"><span className="eyebrow">{site.phase}</span><span className="strategy">{site.strategy}</span></div><h3>{site.name}</h3><p>{site.current_goal || '未填写本轮目标。'}</p>
    <dl><div><dt>下一行动</dt><dd>{site.next_action || '未填写'}</dd></div><div><dt>检查点</dt><dd>{formatDate(site.next_checkpoint, timezone)}</dd></div><div><dt>最近决策</dt><dd>{site.last_decision || '未填写'}</dd></div></dl>
    {site.strategy === '观察' && <p className="condition-note">等待：{site.strategy_condition} · {formatDate(site.strategy_condition_due_on, timezone)}</p>}
    {site.strategy === '暂停' && <p className="condition-note">重启条件：{site.strategy_condition}</p>}
    {site.strategy === '归档' && <p className="condition-note">归档原因：{site.archive_reason}</p>}
    {site.asset_links && <div className="asset-links">{site.asset_links.split('\n').map((link) => link.trim()).filter(isHttpUrl).map((link, index) => <a key={`${link}-${index}`} href={link} target="_blank" rel="noreferrer">{link}</a>)}</div>}
    <p className={`freshness-note ${needsRefresh ? 'stale' : ''}`}>{latestLog ? `${needsRefresh ? '需要刷新 · ' : ''}采集于 ${formatDate(latestLog.collected_at.slice(0, 10), timezone)} · 观察截至 ${formatDate(latestLog.observed_through, timezone)} · 最终确认截至 ${formatDate(latestLog.finalized_through, timezone)}` : '尚未记录数据覆盖日期'}</p>
    <small className="version-note">version {site.version} · 更新于 {formatDate(site.updated_at.slice(0, 10), timezone)}</small>
    <div className="card-actions"><button className="small-button" onClick={() => setHandoffVisible(!handoffVisible)}>{handoffVisible ? '收起交接包' : '生成交接包'}</button></div>
    {handoffVisible && <div className="handoff-box"><button className="small-button" onClick={() => void copyHandoff()}>复制</button>{copyMessage && <span role="status">{copyMessage}</span>}<textarea readOnly value={handoff} rows={8} aria-label={`${site.name}交接包`} /></div>}
    <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>策略、报告与来源记录</summary><SiteContextForm site={site} onSave={onContext} /><SiteStrategyForm site={site} timezone={timezone} onSave={onStrategy} /><TimelineForm site={site} timezone={timezone} onAppend={onTimeline} /><ReportPanel site={site} timezone={timezone} onConfirm={onReport} /><SiteLogHistory client={client} siteId={site.id} siteVersion={site.version} refreshVersion={workspaceRefreshVersion} timezone={timezone} expanded={detailsOpen} targetLogId={targetLogId} targetLog={targetLog} focusIntent={focusIntent} /></details>
  </article>
}

function Calendar({ data, loading, timezone, onTask, pendingTaskIds }: { data: WorkspaceData; loading: boolean; timezone: string; onTask: (task: Task, patch: Partial<Pick<Task, 'due_on' | 'status'>>) => Promise<boolean>; pendingTaskIds: Set<string> }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekInTimeZone(timezone))
  useEffect(() => setWeekStart(startOfWeekInTimeZone(timezone)), [timezone])
  const days = Array.from({ length: 7 }, (_, index) => addDateDays(weekStart, index))
  const today = todayInTimeZone(timezone)
  const siteById = new Map(data.sites.map((site) => [site.id, site]))
  const openTasks = data.tasks.filter((task) => task.status !== '完成')
  return <section className="page" aria-busy={loading}>
    <div className="intro-row"><div><span className="eyebrow">同源安排</span><h2>任务日历</h2><p className="lede">日历只从 tasks 渲染；完成和改期会更新同一条任务。</p></div></div>
    <div className="calendar-toolbar"><button className="small-button" onClick={() => setWeekStart((date) => addDateDays(date, -7))}>上一周</button><strong>{formatDate(days[0], timezone)} – {formatDate(days[6], timezone)}</strong><button className="small-button" onClick={() => setWeekStart((date) => addDateDays(date, 7))}>下一周</button></div>
    <LoadingOrEmpty loading={loading} count={openTasks.length} empty="没有待处理任务。">
      <div className="calendar-scroll" role="region" aria-label="本周七日任务" tabIndex={0} aria-busy={loading}>
        <div className="calendar-grid">{days.map((day) => {
          const dayTasks = openTasks.filter((task) => task.due_on === day)
          const headingId = `calendar-day-${day}`
          return <section className={`day-column ${day === today ? 'today' : ''}`} key={day} aria-labelledby={headingId}>
            <h3 id={headingId} tabIndex={-1}>{day === today ? '今天' : weekdayForDateOnly(day, timezone)}</h3>
            <time dateTime={day}>{formatDate(day, timezone)}</time>
            <ol className="calendar-task-list" aria-label={`${formatDate(day, timezone)}的任务`}>{dayTasks.map((task) => <li key={task.id}>
              <article className="calendar-event">
                <Link className="calendar-task-link" to={`/sites#site-${task.site_id}`}><b>{task.type}</b>{task.title}<small>{siteById.get(task.site_id)?.name ?? '异常站点'}</small></Link>
                <button className="small-button" aria-label={`完成任务：${task.title}`} disabled={pendingTaskIds.has(task.id)} onClick={() => void onTask(task, { status: '完成' })}>完成</button>
                <TaskDateControl task={task} onTask={onTask} pending={pendingTaskIds.has(task.id)} />
              </article>
            </li>)}</ol>
          </section>
        })}</div>
      </div>
    </LoadingOrEmpty>
  </section>
}

function Captures({ client, text, setText, captures, sites, loading, timezone, workspaceRefreshVersion, onCreate, onRoute }: {
  client: SupabaseClient
  text: string
  setText: (value: string) => void
  captures: Capture[]
  sites: Site[]
  loading: boolean
  timezone: string
  workspaceRefreshVersion: number
  onCreate: (text: string) => Promise<void>
  onRoute: (capture: Capture, route: Parameters<typeof routeCapture>[2]) => Promise<void>
}) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState(false)
  const [routeFocusTarget, setRouteFocusTarget] = useState<string | null | undefined>(undefined)
  const addCaptureButtonRef = useRef<HTMLButtonElement>(null)
  const captureInputRef = useRef<HTMLTextAreaElement>(null)
  const previousOpenRef = useRef(false)
  const newCaptureIdsRef = useRef<Set<string> | null>(null)
  const skipReturnFocusRef = useRef(false)
  const mountedRef = useRef(false)
  const targetCaptureId = location.pathname === '/captures' ? location.hash.match(/^#capture-(.+)$/)?.[1] ?? null : null
  const historyTargetCaptureId = targetCaptureId && !loading && !captures.some((capture) => capture.id === targetCaptureId)
    ? targetCaptureId
    : null
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    if (open) captureInputRef.current?.focus()
    else if (previousOpenRef.current) {
      if (skipReturnFocusRef.current) skipReturnFocusRef.current = false
      else addCaptureButtonRef.current?.focus()
    }
    previousOpenRef.current = open
  }, [open])
  useEffect(() => {
    const oldIds = newCaptureIdsRef.current
    if (!oldIds) return
    const created = captures.find((capture) => !oldIds.has(capture.id))
    if (!created) return
    document.getElementById(`capture-${created.id}`)?.querySelector<HTMLElement>('[data-focus-target="capture-route"]')?.focus()
    newCaptureIdsRef.current = null
  }, [captures])
  useEffect(() => {
    if (routeFocusTarget === undefined) return
    const target = routeFocusTarget
      ? document.getElementById(`capture-${routeFocusTarget}`)?.querySelector<HTMLElement>('[data-focus-target="capture-route"]')
      : addCaptureButtonRef.current
    target?.focus()
    setRouteFocusTarget(undefined)
  }, [routeFocusTarget, captures])
  useEffect(() => { if (historyTargetCaptureId) setHistoryOpen(true) }, [historyTargetCaptureId])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) { setError('请先写下一句话；这里只保存文字。'); setFieldError(true); return }
    setSaving(true); setError('')
    setFieldError(false)
    newCaptureIdsRef.current = new Set(captures.map((capture) => capture.id))
    try {
      await onCreate(text)
      if (mountedRef.current) { skipReturnFocusRef.current = true; setText(''); setOpen(false) }
    } catch (err) {
      newCaptureIdsRef.current = null
      if (mountedRef.current) setError(err instanceof Error ? err.message : '随手记保存失败，请重试')
    } finally { if (mountedRef.current) setSaving(false) }
  }
  const routeCaptureWithFocus = async (capture: Capture, route: Parameters<typeof routeCapture>[2]) => {
    const captureIndex = captures.findIndex((item) => item.id === capture.id)
    const followingCapture = captures[captureIndex + 1] ?? captures[captureIndex - 1] ?? null
    await onRoute(capture, route)
    setRouteFocusTarget(followingCapture?.id ?? null)
  }
  return <section className="page" aria-busy={loading}><div className="intro-row"><div><span className="eyebrow">稍后人工整理</span><h2>待整理</h2><p className="lede">先保存非空文字，再人工决定去向。</p></div><button ref={addCaptureButtonRef} className="primary-button" disabled={saving} onClick={() => setOpen(true)}>+ 随手记</button></div>
    {open && <form className="panel capture-form" onSubmit={submit}><label>原始文字<textarea ref={captureInputRef} id="capture-input" required rows={4} value={text} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? 'capture-input-error' : undefined} onChange={(event) => { setText(event.target.value); setError(''); setFieldError(false) }} placeholder="粘贴你自行转写的需求、用户原话或待确认问题" /></label>{error && <p id="capture-input-error" className="form-error" role="alert">{error}</p>}<div className="capture-actions"><button type="button" className="small-button" onClick={() => setOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={saving}>保存到待整理</button></div></form>}
    <LoadingOrEmpty loading={loading} count={captures.length} empty="还没有待整理文字。"><div className="capture-list">{captures.map((capture) => <article id={`capture-${capture.id}`} tabIndex={-1} className="capture-card" key={capture.id}><div className="card-top"><span className="eyebrow">{capture.status}</span><time dateTime={capture.created_at}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(capture.created_at))}</time></div><p>{capture.text}</p><CaptureRouteForm capture={capture} sites={sites} timezone={timezone} onRoute={routeCaptureWithFocus} /></article>)}</div></LoadingOrEmpty>
    <details open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}><summary>已处理随手记历史</summary><ProcessedCaptureHistory client={client} expanded={historyOpen} refreshVersion={workspaceRefreshVersion} targetCaptureId={historyTargetCaptureId} focusIntent={`${location.key}:${location.hash}`} /></details>
  </section>
}
