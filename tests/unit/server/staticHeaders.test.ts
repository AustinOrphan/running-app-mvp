// What the built app is served with (phase 3a design 7.4, ADR 0012): the page, the service worker
// and the manifest are revalidated on every load, because a stale copy of any of them holds an old
// build in place; the hashed assets are cached for a year.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mountStatic } from '../../../server/static.ts'

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
