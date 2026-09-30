import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { loadSiteLogPage } from '../lib/repository'
import { formatDateOnly } from '../lib/dates'
import type { Log } from '../lib/types'

type SiteLogHistoryProps = {
  client: SupabaseClient
  siteId: string
  siteVersion: number
  refreshVersion: number
  timezone: string
  expanded: boolean
  targetLogId?: string | null
  targetLog?: Log | null
  focusIntent: string
}

export function SiteLogHistory({ client, siteId, siteVersion, refreshVersion, timezone, expanded, targetLogId = null, targetLog = null, focusIntent }: SiteLogHistoryProps) {
  const [logs, setLogs] = useState<Log[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const mounted = useRef(false)
  const focusIntentRef = useRef('')
  const focusConsumedRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestSequence.current += 1
    }
  }, [])

  const load = useCallback(async (offset: number, replace: boolean) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    try {
      const page = await loadSiteLogPage(client, siteId, offset)
      if (!mounted.current || sequence !== requestSequence.current) return
      setLogs((current) => replace ? page.items : [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))])
      setNextOffset(page.page.nextOffset)
    } catch (reason) {
      if (mounted.current && sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : '读取来源记录失败')
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false)
    }
  }, [client, siteId])

  useEffect(() => {
    if (expanded) void load(0, true)
    else {
      requestSequence.current += 1
      setLogs([])
      setNextOffset(null)
      setError(null)
    }
  }, [expanded, siteId, siteVersion, refreshVersion, load])

  useEffect(() => {
    if (focusIntentRef.current !== focusIntent) {
      focusIntentRef.current = focusIntent
      focusConsumedRef.current = false
    }
    if (focusConsumedRef.current || !targetLogId || !expanded) return
    const available = targetLogId && (logs.some((log) => log.id === targetLogId) || targetLog?.id === targetLogId)
    if (!available) return
    const target = document.getElementById(`log-${targetLogId}`)
    if (!target) return
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
    if (document.activeElement === target) focusConsumedRef.current = true
  }, [expanded, focusIntent, logs, targetLog, targetLogId])

  const displayedLogs = targetLog && targetLog.site_id === siteId && !logs.some((log) => log.id === targetLog.id)
    ? [targetLog, ...logs]
    : logs

  return <div className="site-logs">
    <h4>来源记录</h4>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="small-button" disabled={loading} onClick={() => void load(0, true)}>重试</button></p>}
    {displayedLogs.length ? displayedLogs.map((log) => <div key={log.id} id={`log-${log.id}`} tabIndex={-1} className="log-item">
      <time>{formatDateOnly(log.collected_at.slice(0, 10), timezone)}</time><p>{log.text}</p>
      {isHttpUrl(log.source_url) && <a href={log.source_url} target="_blank" rel="noreferrer">原始来源</a>}
      {log.capture_id && <Link to={`/captures#capture-${log.capture_id}`}> · 查看原始随手记</Link>}
    </div>) : !loading && !error ? <p>暂无来源记录</p> : null}
    {loading && <p>正在读取来源记录…</p>}
    {nextOffset !== null && !loading && <button type="button" className="small-button" disabled={loading} onClick={() => void load(nextOffset, false)}>加载更早记录</button>}
  </div>
}

function isHttpUrl(value: string | null): value is string {
  if (!value) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) }
  catch { return false }
}
