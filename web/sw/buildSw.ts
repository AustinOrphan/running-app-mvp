// Writes the service worker into the build (phase 3a design 7.6, ADR 0012). `sw.js` is hand-written
// and not passed through the bundler; this plugin runs after the bundle is on disk, lists what the
// shell must keep, derives the build id from it and writes the worker with both substituted. It
// uses only Node's own modules, so the worker needs no library.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Where the worker's source is, next to this file. */
export const SW_SOURCE = fileURLToPath(new URL('./sw.js', import.meta.url))

/** The two places in `sw.js` that the build fills in. Either quote style, for a formatter's sake. */
const BUILD_ID_MARKER = /(['"])__BUILD_ID__\1/g
const PRECACHE_MARKER = /\[\s*(['"])__PRECACHE__\1,?\s*\]/g

/**
 * The worker with its build id and its list of files filled in. Throws when the template does not
 * hold each marker exactly once, so a worker never ships with a marker left in it.
 */
export function renderSw(template: string, buildId: string, precache: readonly string[]): string {
  for (const [name, marker] of [
    ['__BUILD_ID__', BUILD_ID_MARKER],
    ['__PRECACHE__', PRECACHE_MARKER],
  ] as const) {
    const count = template.match(marker)?.length ?? 0
    if (count !== 1) throw new Error(`sw.js must contain ${name} exactly once, found ${count}.`)
  }
  return template
    .replace(BUILD_ID_MARKER, () => JSON.stringify(buildId))
    .replace(PRECACHE_MARKER, () => JSON.stringify(precache))
}

/**
 * Whether a file of the build (a path under the output folder, with `/`) goes in the shell: every
 * file in the root except the worker itself (the page, the manifest, the icons), and under
 * `assets/` every script and style (the lazy chunks too, so a sheet or the Explain drawer opens
 * offline) and the latin fonts. The web worker of the Apple Health import (it needs a connection
 * anyway), other scripts' fonts and source maps stay out.
 */
export function isPrecached(path: string): boolean {
  if (path === 'sw.js' || path.endsWith('.map')) return false
  if (!path.includes('/')) return true
  if (!path.startsWith('assets/')) return false
  const name = path.slice('assets/'.length)
  if (/\.worker-[^/]*\.js$/.test(name)) return false
  if (name.endsWith('.js') || name.endsWith('.css')) return true
  return /-latin-(?!ext)[^/]*\.woff2$/.test(name)
}

/** Every file under `dir`, as a sorted list of `/`-separated paths relative to it. */
export function listFiles(dir: string, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...listFiles(dir, path))
    else files.push(path)
  }
  return files.sort()
}

/**
 * The build id: twelve hex digits over the worker's source and the name and bytes of every file in
 * the shell. The same build gives the same id and the same worker, and any change to a file of the
 * shell, or to the worker itself, gives a new one.
 */
export function buildIdFor(
  template: string,
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
): string {
  const hash = createHash('sha256').update(template).update('\0')
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(file.path).update('\0').update(file.bytes).update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}

export interface EmittedWorker {
  buildId: string
  /** The URL paths the worker keeps: `/index.html`, `/assets/...`. */
  precache: string[]
}

/** Writes `sw.js` into `outDir` for the files already there. */
export function emitServiceWorker(options: { outDir: string; template: string }): EmittedWorker {
  const { outDir, template } = options
  const paths = listFiles(outDir).filter(isPrecached)
  const buildId = buildIdFor(
    template,
    paths.map((path) => ({ path, bytes: readFileSync(join(outDir, path)) })),
  )
  const precache = paths.map((path) => `/${path}`)
  writeFileSync(join(outDir, 'sw.js'), renderSw(template, buildId, precache))
  return { buildId, precache }
}

/** The Vite plugin: after the bundle is written, `dist/web/sw.js` is written beside it. */
export function serviceWorkerPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'running-log-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const { buildId, precache } = emitServiceWorker({
        outDir,
        template: readFileSync(SW_SOURCE, 'utf8'),
      })
      this.info(`sw.js written: build ${buildId}, ${String(precache.length)} files kept`)
    },
  }
}
