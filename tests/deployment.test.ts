import { describe, expect, it } from 'vitest'
import { deploymentHeadersPlugin, renderHeaders, supabaseOrigin } from '../scripts/deployment'

describe('deployment headers', () => {
  it('keeps the default build same-origin only', () => {
    const headers = renderHeaders(undefined)

    expect(headers).toContain("connect-src 'self'")
    expect(headers).not.toContain('supabase.co')
    expect(headers).toContain("script-src 'self'")
    expect(headers).toContain("style-src 'self'")
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
  })

  it('emits only the origin for a configured Supabase URL', () => {
    expect(supabaseOrigin('https://project.supabase.co/')).toBe('https://project.supabase.co')
    expect(renderHeaders('https://project.supabase.co/')).toContain("connect-src 'self' https://project.supabase.co")
    expect(renderHeaders('https://project.supabase.co/')).not.toContain('VITE_SUPABASE_URL')
  })

  it('rejects invalid or line-injected configuration', () => {
    expect(() => supabaseOrigin('http://project.supabase.co')).toThrow(/HTTPS URL|HTTPS origin/)
    expect(() => supabaseOrigin('https://project.supabase.co\r\nX-Leak: value')).toThrow(/line breaks/)
    expect(() => supabaseOrigin('https://project.supabase.co/api')).toThrow(/without credentials/)
  })

  it('writes _headers during the Vite build', () => {
    let emitted = ''
    const plugin = deploymentHeadersPlugin(undefined)
    plugin.generateBundle?.call({ emitFile: ({ source }) => { emitted = String(source) } } as never, {} as never, {} as never)

    expect(emitted).toContain('Content-Security-Policy:')
    expect(emitted).toContain('X-Content-Type-Options: nosniff')
  })
})
