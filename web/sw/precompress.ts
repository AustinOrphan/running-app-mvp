// Writes a brotli and a gzip copy beside each compressible file of the build, so the server sends
// the bytes with no work per request (`server/static.ts`). Runs after the service worker is written
// (`sw.js` is compressed too) and the copies are never part of the shell (`isPrecached`).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

/** The extensions worth compressing; fonts and images are already compressed. */
export const COMPRESSIBLE = ['.html', '.js', '.css', '.svg', '.json', '.webmanifest']

/** Under this many bytes the headers cost more than the saving. */
export const MIN_BYTES = 1024

function compressibleFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...compressibleFiles(path))
    else if (COMPRESSIBLE.some((ext) => entry.name.endsWith(ext))) files.push(path)
  }
  return files
}

/** Writes `<file>.br` and `<file>.gz` for each file over `MIN_BYTES`; returns how many files. */
export function precompressDir(outDir: string): number {
  let count = 0
  for (const path of compressibleFiles(outDir)) {
    if (statSync(path).size < MIN_BYTES) continue
    const bytes = readFileSync(path)
    writeFileSync(
      `${path}.br`,
      brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    )
    writeFileSync(`${path}.gz`, gzipSync(bytes, { level: 9 }))
    count += 1
  }
  return count
}

/** The Vite plugin; list it after the service worker plugin. */
export function precompressPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'running-log-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      this.info(`${String(precompressDir(outDir))} files precompressed (br, gz)`)
    },
  }
}
