// Keeps the research bundle to what the Research page and the why drawer render. A paper record in
// `research/papers/*.json` also holds the vetting evidence (`verification`, the notes of `vetting`)
// and the `implications`, about 45% of its bytes, that no page shows; `npm run research:check`
// still reads the full files. The page shows only who signed off, so `vetting` keeps that.
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

const PAPER_FILE = /[\\/]research[\\/]papers[\\/][^\\/]+\.json$/

/** The fields of a paper record that the page does not render are dropped. */
export function trimPaper(record: Record<string, unknown>): Record<string, unknown> {
  const { verification: _verification, implications: _implications, vetting, ...kept } = record
  const signedOff =
    typeof vetting === 'object' && vetting !== null
      ? (vetting as { signedOff?: unknown }).signedOff
      : undefined
  return typeof signedOff === 'string' ? { ...kept, vetting: { signedOff } } : kept
}

export function researchTrimPlugin(): Plugin {
  return {
    name: 'running-log-research-trim',
    enforce: 'pre',
    apply: 'build',
    // Replaces the file's text before Vite's JSON plugin turns it into a module.
    load(id) {
      if (!PAPER_FILE.test(id)) return null
      const record = JSON.parse(readFileSync(id, 'utf8')) as Record<string, unknown>
      return JSON.stringify(trimPaper(record))
    },
  }
}
