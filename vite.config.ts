import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { deploymentHeadersPlugin } from './scripts/deployment'

function manualVendorChunk(id: string): string | undefined {
  const normalizedId = id.split('\\').join('/')
  if (normalizedId.includes('/node_modules/@supabase/')) return 'vendor-supabase'
  if (/(?:^|\/)node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler)(?:\/|$)/.test(normalizedId)) {
    return 'vendor-react'
  }
  return undefined
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), deploymentHeadersPlugin(env.VITE_SUPABASE_URL)],
    build: { rollupOptions: { output: { manualChunks: manualVendorChunk } } },
  }
})
