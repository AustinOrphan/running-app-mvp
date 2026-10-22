import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The built SPA sits at dist/web. Compiled, this file is dist/server/static.js (so ../web);
 * from source it is server/static.ts (so ../dist/web).
 */
function findWebRoot(): string | null {
  for (const candidate of [resolve(here, '../web'), resolve(here, '../dist/web')]) {
    if (existsSync(resolve(candidate, 'index.html'))) return candidate
  }
  return null
}

/** Serves the built SPA with an index.html fallback; does nothing when there is no build. */
export function mountStatic(app: Express): void {
  const root = findWebRoot()
  if (!root) return

  app.use(
    '/assets',
    express.static(resolve(root, 'assets'), { immutable: true, maxAge: '1y', index: false }),
  )
  app.use(
    express.static(root, {
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.get(/^\/(?!api(?:\/|$)|assets\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    // The root option keeps the dotfile check to the relative part, so a checkout under a hidden
    // directory still serves the page.
    res.sendFile('index.html', { root })
  })
}
