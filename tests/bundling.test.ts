import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const evidenceDirectory = resolve(projectRoot, '.codex-adaptive-agents/p1-performance')

async function buildProbe(marker: string, outputDirectory: string) {
  const buildScript = `
    import { createHash } from 'node:crypto'
    import { build } from 'vite'
    import { resolve } from 'node:path'

    const marker = ${JSON.stringify(marker)}
    const outputDirectory = ${JSON.stringify(outputDirectory)}
    const root = process.cwd()
    const cycleWarnings = []
    let resolvedMode = null
    const result = await build({
      root,
      configFile: resolve(root, 'vite.config.ts'),
      mode: 'production',
      logLevel: 'silent',
      plugins: [{
        name: 'bundle-probe-' + marker,
        enforce: 'post',
        configResolved(config) { resolvedMode = config.mode },
        transform(code, id) {
          if (!id.split('\\\\').join('/').endsWith('/src/main.tsx')) return null
          return code + '\\ndocument.documentElement.setAttribute("data-p1-bundle-probe", ' + JSON.stringify(marker) + ');'
        },
      }],
      build: {
        outDir: outputDirectory,
        emptyOutDir: true,
        rollupOptions: {
          onwarn(warning, defaultHandler) {
            if (warning.code === 'CIRCULAR_DEPENDENCY') cycleWarnings.push(warning.message)
            defaultHandler(warning)
          },
        },
      },
    })
    if (!result) throw new Error('Vite produced no output for ' + marker)
    const outputs = Array.isArray(result) ? result : [result]
    const chunks = outputs.flatMap(output => output.output.filter(item => item.type === 'chunk'))
    process.stdout.write(JSON.stringify({
      mode: resolvedMode,
      nodeEnv: process.env.NODE_ENV ?? null,
      cycleWarnings,
      chunks: chunks.map(chunk => ({
        fileName: chunk.fileName,
        isEntry: chunk.isEntry,
        sizeBytes: Buffer.byteLength(chunk.code),
        sha256: createHash('sha256').update(chunk.code).digest('hex'),
        imports: [...chunk.imports],
        dynamicImports: [...chunk.dynamicImports],
        moduleIds: Object.keys(chunk.modules),
      })),
    }) + '\\n')
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', buildScript], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '')
  if (report.mode !== 'production' || report.nodeEnv !== 'production') {
    throw new Error(`Expected production child build, got mode=${report.mode} NODE_ENV=${report.nodeEnv}`)
  }

  for (const chunk of report.chunks) {
    const bytes = await readFile(resolve(outputDirectory, chunk.fileName))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== chunk.sizeBytes || sha256 !== chunk.sha256) {
      throw new Error(`On-disk bundle differs from build report: ${chunk.fileName}`)
    }
  }
  return report
}

function chunkHashes(chunks: Awaited<ReturnType<typeof buildProbe>>['chunks'], pattern: RegExp) {
  return chunks.filter((chunk) => pattern.test(chunk.fileName)).map(({ fileName, sha256, sizeBytes }) => ({
    fileName,
    sha256,
    sizeBytes,
  })).sort((left, right) => left.fileName.localeCompare(right.fileName))
}

function crossChunkCycleWarnings(run: Awaited<ReturnType<typeof buildProbe>>): string[] {
  const chunkByModule = new Map<string, string>()
  for (const chunk of run.chunks) {
    for (const moduleId of chunk.moduleIds) {
      const relativeId = moduleId.startsWith(`${projectRoot}/`) ? moduleId.slice(projectRoot.length + 1) : moduleId
      chunkByModule.set(relativeId, chunk.fileName)
    }
  }

  return run.cycleWarnings.filter((warning) => {
    const prefix = 'Circular dependency: '
    if (!warning.startsWith(prefix)) return true
    const moduleIds = warning.slice(prefix.length).split(' -> ')
    const chunks = moduleIds.map((moduleId) => chunkByModule.get(moduleId))
    return chunks.some((fileName) => fileName === undefined) || new Set(chunks).size > 1
  })
}

function emittedChunkGraphCycles(chunks: Awaited<ReturnType<typeof buildProbe>>['chunks']): string[][] {
  const filenames = new Set(chunks.map((chunk) => chunk.fileName))
  const imports = new Map(chunks.map((chunk) => [
    chunk.fileName,
    [...chunk.imports, ...chunk.dynamicImports].filter((filename) => filenames.has(filename)),
  ]))
  const activePath: string[] = []
  const activeIndex = new Map<string, number>()
  const complete = new Set<string>()
  const cycles = new Set<string>()

  function visit(filename: string) {
    const cycleStart = activeIndex.get(filename)
    if (cycleStart !== undefined) {
      cycles.add([...activePath.slice(cycleStart), filename].join(' -> '))
      return
    }
    if (complete.has(filename)) return

    activeIndex.set(filename, activePath.length)
    activePath.push(filename)
    for (const imported of imports.get(filename) ?? []) visit(imported)
    activePath.pop()
    activeIndex.delete(filename)
    complete.add(filename)
  }

  for (const filename of filenames) visit(filename)
  return [...cycles].map((cycle) => cycle.split(' -> '))
}

async function mainDistVendorChunks(pattern: RegExp) {
  const assetsDirectory = resolve(projectRoot, 'dist/assets')
  const filenames = (await readdir(assetsDirectory)).filter((filename) => pattern.test(filename))
  return Promise.all(filenames.map(async (fileName) => {
    const bytes = await readFile(resolve(assetsDirectory, fileName))
    return {
      fileName: `assets/${fileName}`,
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })).then((chunks) => chunks.sort((left, right) => left.fileName.localeCompare(right.fileName)))
}

describe('production vendor chunking', () => {
  it('keeps vendor hashes stable when only the app entry changes', async () => {
    await mkdir(evidenceDirectory, { recursive: true })
    const before = await buildProbe('probe-before', resolve(evidenceDirectory, 'dist-a'))
    const after = await buildProbe('probe-after', resolve(evidenceDirectory, 'dist-b'))
    const chunkCycleWarnings = {
      before: crossChunkCycleWarnings(before),
      after: crossChunkCycleWarnings(after),
    }
    const chunkGraphCycles = {
      before: emittedChunkGraphCycles(before.chunks),
      after: emittedChunkGraphCycles(after.chunks),
    }
    const mainDist = {
      react: await mainDistVendorChunks(/vendor-react/),
      supabase: await mainDistVendorChunks(/vendor-supabase/),
    }
    const evidence = {
      generatedAt: new Date().toISOString(),
      environment: {
        testRunnerNodeEnv: process.env.NODE_ENV ?? null,
        buildMode: 'production',
        buildNodeEnv: 'production',
        isolatedBuildProcess: true,
      },
      mainDist,
      runs: { before, after },
      chunkCycleWarnings,
      chunkGraphCycles,
    }
    await writeFile(resolve(evidenceDirectory, 'bundling-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)

    const reactBefore = chunkHashes(before.chunks, /vendor-react/)
    const reactAfter = chunkHashes(after.chunks, /vendor-react/)
    const supabaseBefore = chunkHashes(before.chunks, /vendor-supabase/)
    const supabaseAfter = chunkHashes(after.chunks, /vendor-supabase/)
    const appBefore = before.chunks.filter((chunk) => chunk.isEntry)
    const appAfter = after.chunks.filter((chunk) => chunk.isEntry)

    expect(before.mode).toBe('production')
    expect(after.mode).toBe('production')
    expect(before.nodeEnv).toBe('production')
    expect(after.nodeEnv).toBe('production')
    expect(reactBefore.length).toBeGreaterThan(0)
    expect(supabaseBefore.length).toBeGreaterThan(0)
    expect(reactAfter).toEqual(reactBefore)
    expect(supabaseAfter).toEqual(supabaseBefore)
    expect(reactBefore).toEqual(mainDist.react)
    expect(supabaseBefore).toEqual(mainDist.supabase)
    expect(reactAfter).toEqual(mainDist.react)
    expect(supabaseAfter).toEqual(mainDist.supabase)
    expect(appBefore.map((chunk) => chunk.sha256)).not.toEqual(appAfter.map((chunk) => chunk.sha256))
    expect([...chunkCycleWarnings.before, ...chunkCycleWarnings.after]).toEqual([])
    expect([...chunkGraphCycles.before, ...chunkGraphCycles.after]).toEqual([])
  })
})
