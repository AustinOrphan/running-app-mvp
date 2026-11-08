// What the built app is served with (phase 3a design 7.4, ADR 0012): the page, the service worker
// and the manifest are revalidated on every load, because a stale copy of any of them holds an old
// build in place; the hashed assets are cached for a year.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mountStatic } from '../../../server/static.ts'
import { precompressDir } from '../../../web/sw/precompress.ts'

let dir = ''
let app: express.Express

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-static-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Running log</title>')
  writeFileSync(join(dir, 'sw.js'), "'use strict'\n")
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Running log"}')
  writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(dir, 'assets', 'index-AbC123.js'), 'export {}')
  app = express()
  mountStatic(app, dir)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('static files', () => {
  test.each(['/index.html', '/sw.js', '/manifest.webmanifest'])(
    '%s is served with no-cache',
    async (path) => {
      const response = await request(app).get(path)
      expect(response.status).toBe(200)
      expect(response.headers['cache-control']).toBe('no-cache')
    },
  )

  test('the service worker is JavaScript and the manifest is a manifest', async () => {
    expect((await request(app).get('/sw.js')).headers['content-type']).toMatch(/javascript/)
    expect((await request(app).get('/manifest.webmanifest')).headers['content-type']).toMatch(
      /manifest\+json/,
    )
  })

  test('the page answers any path of the app, and no-cache too', async () => {
    const response = await request(app).get('/plan')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.text).toContain('Running log')
  })

  test('hashed assets are cached for a year, and an icon keeps the default validators', async () => {
    const asset = await request(app).get('/assets/index-AbC123.js')
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const icon = await request(app).get('/icon.svg')
    expect(icon.headers['cache-control']).not.toBe('no-cache')
    expect(icon.headers['etag']).toBeDefined()
  })

  test('does nothing without a build', async () => {
    const bare = express()
    mountStatic(bare, null)
    expect((await request(bare).get('/sw.js')).status).toBe(404)
  })
})

describe('precompressed files', () => {
  const asset = 'export const x = 1\n'.repeat(200)
  let root = ''
  let built: express.Express

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'rl-static-br-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(
      join(root, 'index.html'),
      `<!doctype html><title>Running log</title>${'x'.repeat(2000)}`,
    )
    writeFileSync(join(root, 'sw.js'), `'use strict'\n${'// worker\n'.repeat(200)}`)
    writeFileSync(join(root, 'assets', 'index-AbC123.js'), asset)
    writeFileSync(join(root, 'assets', 'tiny-AbC123.js'), 'export {}')
    writeFileSync(join(root, 'assets', 'font-AbC123.woff2'), 'f'.repeat(4000))
    // The build's own writer, so the test covers what ships.
    precompressDir(root)
    built = express()
    mountStatic(built, root)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('the build writes copies of the text files over 1 kB and of nothing else', () => {
    for (const name of ['assets/index-AbC123.js', 'index.html', 'sw.js']) {
      expect(existsSync(join(root, `${name}.br`)), name).toBe(true)
      expect(existsSync(join(root, `${name}.gz`)), name).toBe(true)
    }
    expect(existsSync(join(root, 'assets', 'tiny-AbC123.js.br'))).toBe(false)
    expect(existsSync(join(root, 'assets', 'font-AbC123.woff2.br'))).toBe(false)
  })

  test('an asset goes out brotli-compressed with its own type and the year-long cache', async () => {
    // The client library decodes the body, so the text proves the stored bytes are the asset's.
    const response = await request(built)
      .get('/assets/index-AbC123.js')
      .set('Accept-Encoding', 'gzip, br')
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBe('br')
    expect(response.headers['vary']).toMatch(/Accept-Encoding/i)
    expect(response.headers['content-type']).toMatch(/javascript/)
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.text).toBe(asset)
  })

  test('a client that accepts only gzip gets the gzip copy', async () => {
    const response = await request(built)
      .get('/assets/index-AbC123.js')
      .set('Accept-Encoding', 'gzip')
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.text).toBe(asset)
  })

  test('a client that accepts neither, or refuses both with q=0, gets the plain file', async () => {
    for (const accept of ['identity', 'br;q=0, gzip;q=0']) {
      const response = await request(built)
        .get('/assets/index-AbC123.js')
        .set('Accept-Encoding', accept)
      expect(response.status).toBe(200)
      expect(response.headers['content-encoding'], accept).toBeUndefined()
      expect(response.headers['vary']).toMatch(/Accept-Encoding/i)
      expect(response.text).toBe(asset)
    }
  })

  test('a file with no copy is served plain', async () => {
    const response = await request(built).get('/assets/tiny-AbC123.js').set('Accept-Encoding', 'br')
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.text).toBe('export {}')
  })

  test('the page, the service worker and the index fallback stay no-cache when compressed', async () => {
    for (const [path, type] of [
      ['/index.html', /text\/html/],
      ['/sw.js', /javascript/],
      ['/plan', /text\/html/],
    ] as const) {
      const response = await request(built).get(path).set('Accept-Encoding', 'br')
      expect(response.status, path).toBe(200)
      expect(response.headers['content-encoding'], path).toBe('br')
      expect(response.headers['cache-control'], path).toBe('no-cache')
      expect(response.headers['vary'], path).toMatch(/Accept-Encoding/i)
      expect(response.headers['content-type'], path).toMatch(type)
    }
  })

  test('a path that climbs out of the build is not read', async () => {
    const response = await request(built)
      .get('/assets/%2e%2e/%2e%2e/package.json')
      .set('Accept-Encoding', 'br')
    expect(response.headers['content-encoding']).toBeUndefined()
  })
})
