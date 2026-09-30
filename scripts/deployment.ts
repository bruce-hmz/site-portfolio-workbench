import type { Plugin } from 'vite'

const SUPABASE_URL_ENV = 'VITE_SUPABASE_URL'

export function supabaseOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  if (/[\r\n]/.test(value)) {
    throw new Error(`${SUPABASE_URL_ENV} must not contain line breaks`)
  }

  type ParsedUrl = {
    protocol: string
    username: string
    password: string
    search: string
    hash: string
    pathname: string
    origin: string
  }

  const UrlConstructor = (globalThis as unknown as { URL?: new (input: string) => ParsedUrl }).URL
  if (!UrlConstructor) throw new Error(`${SUPABASE_URL_ENV} cannot be validated in this runtime`)

  let parsed: ParsedUrl
  try {
    parsed = new UrlConstructor(value.trim())
  } catch {
    throw new Error(`${SUPABASE_URL_ENV} must be a valid HTTPS URL`)
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new Error(`${SUPABASE_URL_ENV} must be an HTTPS origin without credentials, path, query, or hash`)
  }

  return parsed.origin
}

export function renderHeaders(supabaseUrl: string | undefined): string {
  const origin = supabaseOrigin(supabaseUrl)
  const connectSource = origin ? `'self' ${origin}` : "'self'"
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src " + connectSource,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; ')

  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n')
}

export function deploymentHeadersPlugin(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'deployment-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: renderHeaders(supabaseUrl) })
    },
  }
}
