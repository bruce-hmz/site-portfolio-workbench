import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { loadCaptureById, loadCaptureDestination, loadCompletedCapturePage } from '../lib/repository'
import type { Capture, CaptureDestination } from '../lib/types'

type ProcessedCaptureHistoryProps = {
  client: SupabaseClient
  expanded: boolean
  refreshVersion: number
  targetCaptureId?: string | null
  focusIntent: string
}

export function ProcessedCaptureHistory({ client, expanded, refreshVersion, targetCaptureId = null, focusIntent }: ProcessedCaptureHistoryProps) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [targetCapture, setTargetCapture] = useState<Capture | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const targetSequence = useRef(0)
  const mounted = useRef(false)
  const focusIntentRef = useRef('')
  const focusConsumedRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestSequence.current += 1
      targetSequence.current += 1
    }
  }, [])

  const load = useCallback(async (offset: number, replace: boolean) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    try {
      const page = await loadCompletedCapturePage(client, offset)
      if (!mounted.current || sequence !== requestSequence.current) return
      setCaptures((current) => replace ? page.items : [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))])
      setNextOffset(page.page.nextOffset)
    } catch (reason) {
      if (mounted.current && sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : '读取已处理随手记失败')
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    if (expanded) void load(0, true)
  }, [expanded, load, refreshVersion])

  useEffect(() => {
    if (expanded) return
    requestSequence.current += 1
    setCaptures([])
    setNextOffset(null)
    setError(null)
  }, [expanded])

  useEffect(() => {
    const sequence = ++targetSequence.current
    setTargetCapture(null)
    setTargetError(null)
    if (!targetCaptureId) return
    void loadCaptureById(client, targetCaptureId).then((capture) => {
      if (!mounted.current || sequence !== targetSequence.current) return
      if (!capture) setTargetError('此随手记不存在，或当前账号无权访问。')
      else setTargetCapture(capture)
    }).catch((reason: unknown) => {
      if (mounted.current && sequence === targetSequence.current) {
        setTargetError(reason instanceof Error ? reason.message : '读取目标随手记失败')
      }
    })
    return () => { targetSequence.current += 1 }
  }, [client, targetCaptureId])

  const displayedCaptures = targetCapture && !captures.some((capture) => capture.id === targetCapture.id)
    ? [targetCapture, ...captures]
    : captures

  useEffect(() => {
    if (focusIntentRef.current !== focusIntent) {
      focusIntentRef.current = focusIntent
      focusConsumedRef.current = false
    }
    if (focusConsumedRef.current || !targetCaptureId) return
    if (!displayedCaptures.some((capture) => capture.id === targetCaptureId)) return
    const target = document.getElementById(`capture-${targetCaptureId}`)
    if (!target) return
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
    if (document.activeElement === target) focusConsumedRef.current = true
  }, [displayedCaptures, focusIntent, targetCaptureId])

  return <section aria-label="已处理随手记历史">
    {targetError && <p className="form-error" role="alert">{targetError}</p>}
    {error && <p className="form-error" role="alert">{error} <button type="button" className="small-button" disabled={loading} onClick={() => void load(0, true)}>重试</button></p>}
    {displayedCaptures.map((capture) => <article key={capture.id} id={`capture-${capture.id}`} tabIndex={-1} className="capture-card processed">
      <time>{capture.created_at.slice(0, 10)}</time><p>{capture.text}</p>
      {capture.status === '已处理'
        ? <small>已处理 · <CaptureDestinationLink client={client} capture={capture} /> · 原始文字已保留</small>
        : <small>待整理 · 原始文字已保留</small>}
    </article>)}
    {loading && <p>正在读取已处理随手记…</p>}
    {nextOffset !== null && !loading && <button type="button" className="small-button" onClick={() => void load(nextOffset, false)}>加载更早随手记</button>}
  </section>
}

function CaptureDestinationLink({ client, capture }: { client: SupabaseClient; capture: Capture }) {
  const [destination, setDestination] = useState<CaptureDestination | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setDestination(null)
    setError(false)
    void loadCaptureDestination(client, capture).then((result) => {
      if (active) setDestination(result)
    }).catch(() => {
      if (active) setError(true)
    })
    return () => { active = false }
  }, [client, capture])

  if (error || !destination) return <span>{error ? '去向读取失败' : '正在读取去向…'}</span>
  if (destination.kind === 'log') return destination.log
    ? <Link to={`/sites#log-${destination.log.id}`}>站点日志</Link>
    : <span>站点日志暂不可用</span>
  if (destination.kind === 'task') return destination.task
    ? <Link to={`/sites#site-${destination.task.site_id}`}>站点任务</Link>
    : <span>站点任务暂不可用</span>
  if (destination.kind === 'opportunity') return destination.opportunity
    ? <Link to={`/opportunities#opportunity-${destination.opportunity.id}`}>新站机会</Link>
    : <span>新站机会暂不可用</span>
  return <span>去向暂不可用</span>
}
