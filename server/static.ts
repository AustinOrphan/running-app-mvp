import { existsSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express, type Request, type RequestHandler } from 'express'

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

/**
 * The files in the root that a browser must ask the server about every time: the page (it names
 * the hashed assets), the service worker (a stale copy would hold an old build in place) and the
 * manifest. Everything else in the root is served with the default validators.
 */
const REVALIDATED = ['index.html', 'sw.js', 'manifest.webmanifest']

/** The encodings the build writes beside a file (`web/sw/precompress.ts`), best first. */
const ENCODINGS = [
  { name: 'br', ext: '.br' },
  { name: 'gzip', ext: '.gz' },
] as const

type Encoding = (typeof ENCODINGS)[number]

/** Whether the request's `Accept-Encoding` lists `name` with a quality above zero. */
function accepts(req: Request, name: string): boolean {
  const header = req.headers['accept-encoding']
  if (typeof header !== 'string') return false
  return header.split(',').some((part) => {
    const [token, ...params] = part.trim().split(';')
    if (token?.trim().toLowerCase() !== name) return false
    const quality = params
      .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(param)?.[1])
      .find((value) => value !== undefined)
    return quality === undefined || Number(quality) > 0
  })
}

/** Whether the build holds a stored copy of `file` in any encoding. */
function hasCopies(file: string): boolean {
  return ENCODINGS.some((enc) => existsSync(file + enc.ext))
}

/** The stored copy of `file` (an absolute path in the root) that the client accepts, if any. */
function precompressedFor(req: Request, file: string): Encoding | null {
  return ENCODINGS.find((enc) => accepts(req, enc.name) && existsSync(file + enc.ext)) ?? null
}

/**
 * Sends the `.br` or `.gz` copy of a file in place of the file when the client accepts it: the
 * request is pointed at the copy and the headers say what it is. The type comes from the original
 * name, since `send` leaves a type that is already set. `Vary` is set whenever a copy exists, even
 * for a client that gets the plain file, so a shared cache keeps the two apart.
 */
function servePrecompressed(root: string): RequestHandler {
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.endsWith('/')) return next()
    let relative: string
    try {
      relative = decodeURIComponent(req.path)
    } catch {
      return next()
    }
    const file = resolve(root, `.${relative}`)
    if (!file.startsWith(root + sep) || extname(file) === '' || !hasCopies(file)) return next()
    res.vary('Accept-Encoding')
    const encoding = precompressedFor(req, file)
    if (!encoding) return next()
    res.setHeader('Content-Encoding', encoding.name)
    res.type(extname(file))
    req.url = `${req.path}${encoding.ext}${req.url.slice(req.path.length)}`
    next()
  }
}

/**
 * Serves the built SPA with an index.html fallback; does nothing when there is no build. `root`
 * is the build folder, found beside the server when not given (a test gives its own).
 */
export function mountStatic(app: Express, root: string | null = findWebRoot()): void {
  if (!root) return
  const revalidated = new Set(REVALIDATED.map((name) => resolve(root, name)))

  app.use(servePrecompressed(resolve(root)))
  app.use(
    '/assets',
    express.static(resolve(root, 'assets'), { immutable: true, maxAge: '1y', index: false }),
  )
  app.use(
    express.static(root, {
      index: false,
      setHeaders: (res, path) => {
        // A stored copy is named `<file>.br` or `<file>.gz`; its policy is the file's.
        if (revalidated.has(resolve(path.replace(/\.(br|gz)$/, '')))) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.get(/^\/(?!api(?:\/|$)|assets\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    // The root option keeps the dotfile check to the relative part, so a checkout under a hidden
    // directory still serves the page.
    const page = resolve(root, 'index.html')
    if (hasCopies(page)) res.vary('Accept-Encoding')
    const encoding = precompressedFor(req, page)
    if (!encoding) {
      res.sendFile('index.html', { root })
      return
    }
    res.setHeader('Content-Encoding', encoding.name)
    res.type('html')
    res.sendFile(`index.html${encoding.ext}`, { root })
  })
}
