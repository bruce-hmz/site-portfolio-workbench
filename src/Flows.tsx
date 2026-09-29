import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { OpportunityFields, SiteContextFields } from './lib/repository'
import type { Capture, Opportunity, ReportDraft, Site, TimelineDraft } from './lib/types'
import { addDateDays, DEFAULT_TIMEZONE, todayInTimeZone } from './lib/dates'

function dateKey(timezone: string, offset = 0) { return addDateDays(todayInTimeZone(timezone), offset) }

const opportunityLabels: [keyof OpportunityFields, string][] = [
  ['problem', '用户问题'], ['evidence', '需求证据'], ['validation', '最小验证动作'],
  ['scope', 'MVP 范围'], ['budget', '投入上限'], ['pass_condition', '通过条件'], ['stop_condition', '停止条件'],
]
const blankOpportunity: OpportunityFields = { problem: '', evidence: '', validation: '', scope: '', budget: '', pass_condition: '', stop_condition: '' }

export function Opportunities({ opportunities, loading, timezone, onCreate, onStatus, onPromote }: {
  opportunities: Opportunity[]
  loading: boolean
  timezone: string
  onCreate: (fields: OpportunityFields) => Promise<void>
  onStatus: (opportunity: Opportunity, status: Opportunity['status']) => Promise<void>
  onPromote: (opportunity: Opportunity, name: string, dueOn: string) => Promise<void>
}) {
  const [fields, setFields] = useState(blankOpportunity)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onCreate(fields); setFields(blankOpportunity) }
    catch (err) { setError(err instanceof Error ? err.message : '机会保存失败') }
    finally { setSaving(false) }
  }
  return <section className="page"><div className="intro-row"><div><span className="eyebrow">先验证，再开始</span><h2>新站计划池</h2><p className="lede">每个想法先写清证据、验证动作和停止条件。</p></div></div>
    <form className="panel stack-form" onSubmit={submit}><h3>记录机会</h3><div className="field-grid">{opportunityLabels.map(([key, label]) => <label key={key}>{label}<textarea required rows={key === 'problem' ? 2 : 1} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<button disabled={saving} className="primary-button">保存机会</button></form>
    {loading && !opportunities.length ? <p className="empty-state">正在读取云端数据…</p> : opportunities.length ? <div className="opportunity-list">{opportunities.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} timezone={timezone} onStatus={onStatus} onPromote={onPromote} />)}</div> : <p className="empty-state">还没有新站机会。</p>}
  </section>
}

function OpportunityCard({ opportunity, timezone, onStatus, onPromote }: {
  opportunity: Opportunity
  timezone: string
  onStatus: (opportunity: Opportunity, status: Opportunity['status']) => Promise<void>
  onPromote: (opportunity: Opportunity, name: string, dueOn: string) => Promise<void>
}) {
  const [name, setName] = useState(opportunity.problem.slice(0, 60))
  const [dueOn, setDueOn] = useState(dateKey(timezone, 7))
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const changeStatus = async (status: Opportunity['status']) => {
    setError(''); setSaving(true)
    try { await onStatus(opportunity, status) }
    catch (err) { setError(err instanceof Error ? err.message : '状态更新失败') }
    finally { setSaving(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onPromote(opportunity, name, dueOn); setOpen(false) }
    catch (err) { setError(err instanceof Error ? err.message : '转入网站失败') }
    finally { setSaving(false) }
  }
  return <article id={`opportunity-${opportunity.id}`} tabIndex={-1} className="panel opportunity-card"><div className="card-top"><strong>{opportunity.problem}</strong><span className="strategy">{opportunity.status}</span></div><p>证据：{opportunity.evidence}</p><p>验证动作：{opportunity.validation}</p><p>投入上限：{opportunity.budget} · 通过：{opportunity.pass_condition} · 停止：{opportunity.stop_condition}</p>{opportunity.capture_id && <Link to={`/captures#capture-${opportunity.capture_id}`}>查看原始随手记</Link>}
    <div className="card-actions"><label>状态 <select disabled={saving || Boolean(opportunity.site_id)} value={opportunity.status} onChange={(event) => void changeStatus(event.target.value as Opportunity['status'])}><option>想法</option><option>验证中</option><option>通过</option><option>停止</option></select></label>{opportunity.site_id ? <span>已转入网站</span> : opportunity.status === '通过' && <button className="small-button" onClick={() => setOpen(true)}>转入网站</button>}</div>
    {open && <form className="stack-form subform" onSubmit={submit}><label>新网站名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>首个行动日期<input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label><div className="card-actions"><button className="small-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="primary-button" disabled={saving}>确认转入</button></div></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </article>
}

export function SiteStrategyForm({ site, timezone = DEFAULT_TIMEZONE, onSave }: {
  site: Site
  timezone?: string
  onSave: (site: Site, strategy: string, condition: string, dueOn: string, archiveReason: string) => Promise<void>
}) {
  const [strategy, setStrategy] = useState(site.strategy)
  const [condition, setCondition] = useState(site.strategy_condition || '')
  const [dueOn, setDueOn] = useState(site.strategy_condition_due_on || dateKey(timezone, 7))
  const [archiveReason, setArchiveReason] = useState(site.archive_reason || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [expectedVersion, setExpectedVersion] = useState(site.version)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onSave({ ...site, version: expectedVersion }, strategy, condition, dueOn, archiveReason); setExpectedVersion(expectedVersion + 1) }
    catch (err) { setError(err instanceof Error ? err.message : '策略保存失败') }
    finally { setSaving(false) }
  }
  return <form className="stack-form subform" onSubmit={submit}><h4>策略</h4><label>当前策略<select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{['推进', '观察', '低频维护', '暂停', '归档'].map((value) => <option key={value}>{value}</option>)}</select></label>
    {['观察', '暂停'].includes(strategy) && <label>{strategy === '观察' ? '等待条件' : '重启条件'}<textarea required value={condition} onChange={(event) => setCondition(event.target.value)} /></label>}
    {strategy === '观察' && <label>检查日期<input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>}
    {strategy === '归档' && <label>归档原因<textarea required value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></label>}
    {site.version !== expectedVersion && <p role="status">网站已有更新。<button type="button" className="small-button" onClick={() => { setStrategy(site.strategy); setCondition(site.strategy_condition || ''); setDueOn(site.strategy_condition_due_on || dateKey(timezone, 7)); setArchiveReason(site.archive_reason || ''); setExpectedVersion(site.version) }}>载入最新策略</button></p>}
    {error && <p className="form-error" role="alert">{error}</p>}<button className="small-button" disabled={saving || site.version !== expectedVersion}>保存策略</button>
  </form>
}

export function SiteContextForm({ site, onSave }: { site: Site; onSave: (site: Site, fields: SiteContextFields) => Promise<void> }) {
  const values = (): SiteContextFields => ({ name: site.name, phase: site.phase, current_goal: site.current_goal, last_decision: site.last_decision, asset_links: site.asset_links })
  const [fields, setFields] = useState(values)
  const [expectedVersion, setExpectedVersion] = useState(site.version)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try { await onSave({ ...site, version: expectedVersion }, fields); setExpectedVersion(expectedVersion + 1) }
    catch (err) { setError(err instanceof Error ? err.message : '网站资料保存失败') }
    finally { setSaving(false) }
  }
  return <form className="stack-form subform" onSubmit={submit}><h4>网站资料</h4><label>网站名称<input required value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} /></label><label>当前阶段<select value={fields.phase} onChange={(event) => setFields({ ...fields, phase: event.target.value })}>{['机会验证', 'MVP 开发', '上线验收', '需求验证', '增长变现', '稳定运营'].map((phase) => <option key={phase}>{phase}</option>)}</select></label><label>本轮目标<textarea value={fields.current_goal} onChange={(event) => setFields({ ...fields, current_goal: event.target.value })} /></label><label>最近决策<textarea value={fields.last_decision} onChange={(event) => setFields({ ...fields, last_decision: event.target.value })} /></label><label>资产链接（每行一个 http/https URL）<textarea value={fields.asset_links} onChange={(event) => setFields({ ...fields, asset_links: event.target.value })} /></label>
    {site.version !== expectedVersion && <p role="status">网站已有更新。<button type="button" className="small-button" onClick={() => { setFields(values()); setExpectedVersion(site.version) }}>载入最新资料</button></p>}
    {error && <p className="form-error" role="alert">{error}</p>}<button className="small-button" disabled={saving || site.version !== expectedVersion}>保存网站资料</button></form>
}

export function ReportPanel({ site, timezone = DEFAULT_TIMEZONE, onConfirm }: { site: Site; timezone?: string; onConfirm: (draft: ReportDraft) => Promise<void> }) {
  const [rawText, setRawText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<ReportDraft | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const extract = () => {
    setError('')
    if (!rawText.trim()) { setError('请先粘贴报告原文'); return }
    const pick = (label: string) => rawText.match(new RegExp(`(?:^|\\n)${label}[：:]\\s*(.+)`, 'i'))?.[1]?.trim() || ''
    setPreview({ id: crypto.randomUUID(), siteId: site.id, siteVersion: site.version, rawText,
      completed: pick('完成'), evidence: pick('证据'), openItems: pick('遗留'), nextStep: pick('下一步') || site.next_action,
      nextActionDate: pick('下一行动日期') || dateKey(timezone, 1), reviewDate: pick('复盘日期') || dateKey(timezone, 7),
      sourceUrl, observedThrough: dateKey(timezone), finalizedThrough: '' })
  }
  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!preview) return
    setError('')
    if (preview.sourceUrl) {
      try { if (!['http:', 'https:'].includes(new URL(preview.sourceUrl).protocol)) throw new Error() }
      catch { setError('来源 URL 必须是完整的 http/https 链接'); return }
    }
    setSaving(true)
    try { await onConfirm(preview); setPreview(null); setRawText(''); setSourceUrl('') }
    catch (err) { setError(err instanceof Error ? err.message : '报告确认失败') }
    finally { setSaving(false) }
  }
  const field = (key: keyof ReportDraft, label: string, date = false) => <label key={key}>{label}{date ? <input required type="date" value={String(preview?.[key] || '')} onChange={(event) => setPreview((current) => current && { ...current, [key]: event.target.value })} /> : <textarea required value={String(preview?.[key] || '')} onChange={(event) => setPreview((current) => current && { ...current, [key]: event.target.value })} />}</label>
  return <div className="report-panel subform"><h4>收尾报告</h4><p>按字段标签生成规则预览；人工确认后才回填。</p><label>原文<textarea rows={5} value={rawText} onChange={(event) => { setRawText(event.target.value); setPreview(null) }} placeholder={'完成：…\n证据：…\n遗留：…\n下一步：…'} /></label><label>原始来源 URL（可选）<input type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setPreview((current) => current && { ...current, sourceUrl: event.target.value }) }} /></label><button type="button" className="small-button" onClick={extract}>生成提取预览</button>
    {preview && <form className="stack-form preview-form" onSubmit={confirm}><strong>规则演示 · 可编辑 · 待确认</strong>{preview.siteVersion !== site.version && <p role="status">网站已有更新，请核对上方下一行动。<button type="button" className="small-button" onClick={() => setPreview({ ...preview, siteVersion: site.version })}>已核对最新状态</button></p>}<div className="field-grid">{field('completed', '完成')}{field('evidence', '证据')}{field('openItems', '遗留')}{field('nextStep', '下一步')}{field('nextActionDate', '下一行动日期', true)}{field('reviewDate', '复盘日期', true)}{field('observedThrough', '数据观察截至', true)}<label>最终确认截至（可选）<input type="date" value={preview.finalizedThrough} onChange={(event) => setPreview({ ...preview, finalizedThrough: event.target.value })} /></label></div><button className="primary-button" disabled={saving || preview.siteVersion !== site.version}>确认回填</button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

export function TimelineForm({ site, timezone = DEFAULT_TIMEZONE, onAppend }: { site: Site; timezone?: string; onAppend: (draft: TimelineDraft) => Promise<void> }) {
  const [expectedVersion, setExpectedVersion] = useState(site.version)
  const [text, setText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextActionDate, setNextActionDate] = useState(dateKey(timezone, 1))
  const [observedThrough, setObservedThrough] = useState(dateKey(timezone))
  const [finalizedThrough, setFinalizedThrough] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (sourceUrl) {
      try { if (!['http:', 'https:'].includes(new URL(sourceUrl).protocol)) throw new Error() }
      catch { setError('来源 URL 必须是完整的 http/https 链接'); return }
    }
    setSaving(true)
    try {
      await onAppend({ siteId: site.id, siteVersion: expectedVersion, text, sourceUrl, nextAction, nextActionDate, observedThrough, finalizedThrough })
      setExpectedVersion(expectedVersion + 1)
      setText(''); setSourceUrl(''); setNextAction('')
    } catch (err) { setError(err instanceof Error ? err.message : '时间线保存失败') }
    finally { setSaving(false) }
  }
  return <form className="stack-form subform" onSubmit={submit}><h4>追加时间线</h4><label>原始记录<textarea required rows={3} value={text} onChange={(event) => setText(event.target.value)} /></label><label>来源 URL（可选）<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label><label>下一行动<input required value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label><div className="field-grid"><label>行动日期<input required type="date" value={nextActionDate} onChange={(event) => setNextActionDate(event.target.value)} /></label><label>数据观察截至<input type="date" value={observedThrough} onChange={(event) => setObservedThrough(event.target.value)} /></label><label>最终确认截至（可选）<input type="date" value={finalizedThrough} onChange={(event) => setFinalizedThrough(event.target.value)} /></label></div>{site.version !== expectedVersion && <p role="status">网站已有更新，请核对上方下一行动。<button type="button" className="small-button" onClick={() => setExpectedVersion(site.version)}>已核对最新状态</button></p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="small-button" disabled={saving || site.version !== expectedVersion}>保存记录与任务</button></form>
}

type CaptureRoute = { kind: 'log'; siteId: string; text: string } | { kind: 'task'; siteId: string; title: string; dueOn: string } | { kind: 'opportunity'; fields: OpportunityFields }

export function CaptureRouteForm({ capture, sites, timezone = DEFAULT_TIMEZONE, onRoute }: {
  capture: Capture
  sites: Site[]
  timezone?: string
  onRoute: (capture: Capture, route: CaptureRoute) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<CaptureRoute['kind']>('log')
  const [siteId, setSiteId] = useState('')
  const [text, setText] = useState(capture.text)
  const [title, setTitle] = useState(capture.text.split('\n')[0].slice(0, 100))
  const [dueOn, setDueOn] = useState(dateKey(timezone, 1))
  const [fields, setFields] = useState<OpportunityFields>({ ...blankOpportunity, problem: capture.text.slice(0, 120) })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    const route: CaptureRoute = kind === 'log' ? { kind, siteId, text } : kind === 'task' ? { kind, siteId, title, dueOn } : { kind, fields }
    try { await onRoute(capture, route); setOpen(false) }
    catch (err) { setError(err instanceof Error ? err.message : '整理失败，原文仍在待整理') }
    finally { setSaving(false) }
  }
  if (!open) return <button className="small-button" onClick={() => setOpen(true)}>人工整理</button>
  return <form className="stack-form subform" onSubmit={submit}><label>去向<select value={kind} onChange={(event) => setKind(event.target.value as CaptureRoute['kind'])}><option value="log">写入站点日志</option><option value="task">转为站点任务</option><option value="opportunity">转入新站计划池</option></select></label>
    {kind !== 'opportunity' && <label>所属网站<select required value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">请选择</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
    {kind === 'log' && <label>整理说明<textarea required value={text} onChange={(event) => setText(event.target.value)} /></label>}
    {kind === 'task' && <><label>任务标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>执行日期<input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label></>}
    {kind === 'opportunity' && <div className="field-grid">{opportunityLabels.map(([key, label]) => <label key={key}>{label}<textarea required value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></label>)}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="card-actions"><button className="small-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="primary-button" disabled={saving}>确认整理</button></div>
  </form>
}
