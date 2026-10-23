// The build step that writes the service worker (phase 3a design 7.6, ADR 0012): the markers it
// fills in, the files it keeps in the shell, the build id and the plugin that runs it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  buildIdFor,
  emitServiceWorker,
  isPrecached,
  listFiles,
  renderSw,
  serviceWorkerPlugin,
  SW_SOURCE,
} from '../../../web/sw/buildSw.ts'

const TEMPLATE = readFileSync(SW_SOURCE, 'utf8')

/** What a script that declares `const BUILD_ID` and `const PRECACHE` holds once it has run. */
function constantsOf(script: string): { buildId: string; precache: string[] } {
  const sandbox: Record<string, unknown> = {
    self: { addEventListener: () => {}, location: { origin: 'https://x.example.com' } },
  }
  vm.runInNewContext(
    `${script}\nglobalThis.out = { buildId: BUILD_ID, precache: PRECACHE }`,
    sandbox,
  )
  return JSON.parse(JSON.stringify(sandbox['out'])) as { buildId: string; precache: string[] }
}

describe('renderSw', () => {
  test('puts the build id and the list into the worker, and leaves no marker behind', () => {
    const out = renderSw(TEMPLATE, 'abc123def456', ['/index.html', '/assets/a-1.js'])
    expect(out).not.toContain('__BUILD_ID__')
    expect(out).not.toContain('__PRECACHE__')
    expect(constantsOf(out)).toEqual({
      buildId: 'abc123def456',
      precache: ['/index.html', '/assets/a-1.js'],
    })
  })

  test('takes the markers in either quote style and across lines (a formatter may change them)', () => {
    const template = 'const BUILD_ID = "__BUILD_ID__"\nconst PRECACHE = [\n  "__PRECACHE__",\n]\n'
    expect(constantsOf(renderSw(template, 'id', ['/a']))).toEqual({
      buildId: 'id',
      precache: ['/a'],
    })
  })

  test('writes a value as data: a "$&" in a file name is not a replacement pattern', () => {
    const out = renderSw(
      "const BUILD_ID = '__BUILD_ID__'\nconst PRECACHE = ['__PRECACHE__']",
      'i',
      ['/assets/a$&b.js'],
    )
    expect(constantsOf(out).precache).toEqual(['/assets/a$&b.js'])
  })

  test.each([
    ['no build id', "const PRECACHE = ['__PRECACHE__']", '__BUILD_ID__'],
    ['no list', "const BUILD_ID = '__BUILD_ID__'", '__PRECACHE__'],
    [
      'two build ids',
      "const A = '__BUILD_ID__'; const B = '__BUILD_ID__'; const P = ['__PRECACHE__']",
      '__BUILD_ID__',
    ],
  ])('refuses a template with %s', (_name, template, marker) => {
    expect(() => renderSw(template, 'id', [])).toThrow(marker)
  })

  test('the shipped source holds each marker once', () => {
    expect(() => renderSw(TEMPLATE, 'id', [])).not.toThrow()
  })
})

describe('what the shell keeps', () => {
  test.each([
    'index.html',
    'manifest.webmanifest',
    'icon.svg',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
    'assets/index-AbC123.js',
    'assets/index-AbC123.css',
    'assets/react-AbC123.js',
    'assets/charts-AbC123.js',
    // The lazy chunks: the sheets, and the corpus the Explain drawer reads.
    'assets/DoneSheet-AbC123.js',
    'assets/CheckinSheet-AbC123.css',
    'assets/FuelLogSheet-AbC123.js',
    'assets/researchBundle-AbC123.js',
    'assets/libre-franklin-latin-wght-normal-AbC123.woff2',
    'assets/source-serif-4-latin-wght-italic-AbC123.woff2',
  ])('keeps %s', (path) => {
    expect(isPrecached(path)).toBe(true)
  })

  test.each([
    'sw.js',
    'assets/index-AbC123.js.map',
    // The web worker of the Apple Health import needs a connection anyway.
    'assets/appleHealth.worker-AbC123.js',
    'assets/libre-franklin-latin-ext-wght-normal-AbC123.woff2',
    'assets/libre-franklin-cyrillic-wght-normal-AbC123.woff2',
    'assets/source-serif-4-vietnamese-wght-normal-AbC123.woff2',
    'assets/photo-AbC123.png',
    'elsewhere/x.js',
    'elsewhere/assets/x.js',
  ])('leaves out %s', (path) => {
    expect(isPrecached(path)).toBe(false)
  })
})

describe('the build id', () => {
  const files = [
    { path: 'index.html', bytes: Buffer.from('<html>') },
    { path: 'assets/a-1.js', bytes: Buffer.from('a') },
  ]

  test('is twelve hex digits and the same for the same build, whatever the order of the files', () => {
    const id = buildIdFor('worker', files)
    expect(id).toMatch(/^[0-9a-f]{12}$/)
    expect(buildIdFor('worker', [...files].reverse())).toBe(id)
  })

  test('changes with a file name, a file body or the worker source', () => {
    const id = buildIdFor('worker', files)
    expect(
      buildIdFor('worker', [{ ...files[0]!, bytes: Buffer.from('<html >') }, files[1]!]),
    ).not.toBe(id)
    expect(buildIdFor('worker', [files[0]!, { ...files[1]!, path: 'assets/a-2.js' }])).not.toBe(id)
    expect(buildIdFor('worker 2', files)).not.toBe(id)
    expect(buildIdFor('worker', [files[0]!])).not.toBe(id)
  })

  test('does not mix a name into a body', () => {
    const one = buildIdFor('w', [{ path: 'a', bytes: Buffer.from('bc') }])
    const two = buildIdFor('w', [{ path: 'ab', bytes: Buffer.from('c') }])
    expect(one).not.toBe(two)
  })
})

describe('emitServiceWorker', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rl-swbuild-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function put(path: string, body = path): void {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  function build(): void {
    put('index.html')
    put('manifest.webmanifest')
    put('icon-192.png')
    put('assets/index-A.js')
    put('assets/index-A.css')
    put('assets/DoneSheet-B.js')
    put('assets/appleHealth.worker-C.js')
    put('assets/libre-franklin-latin-wght-normal-D.woff2')
    put('assets/libre-franklin-greek-wght-normal-E.woff2')
  }

  test('writes sw.js beside the build with the id and the list of kept files', () => {
    build()
    const { buildId, precache } = emitServiceWorker({ outDir: dir, template: TEMPLATE })
    expect(precache).toEqual([
      '/assets/DoneSheet-B.js',
      '/assets/index-A.css',
      '/assets/index-A.js',
      '/assets/libre-franklin-latin-wght-normal-D.woff2',
      '/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ])
    const written = readFileSync(join(dir, 'sw.js'), 'utf8')
    expect(constantsOf(written)).toEqual({ buildId, precache })
    expect(written).not.toContain('__BUILD_ID__')
  })

  test('a second run over the same build gives the same worker, the first one not being counted', () => {
    build()
    const first = emitServiceWorker({ outDir: dir, template: TEMPLATE })
    const firstBytes = readFileSync(join(dir, 'sw.js'), 'utf8')
    const second = emitServiceWorker({ outDir: dir, template: TEMPLATE })
    expect(second).toEqual(first)
    expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toBe(firstBytes)
    expect(second.precache).not.toContain('/sw.js')
  })

  test('a changed file gives a new build id', () => {
    build()
    const before = emitServiceWorker({ outDir: dir, template: TEMPLATE }).buildId
    put('assets/index-A.js', 'changed')
    expect(emitServiceWorker({ outDir: dir, template: TEMPLATE }).buildId).not.toBe(before)
  })

  test('a file the shell does not keep changes nothing', () => {
    build()
    const before = emitServiceWorker({ outDir: dir, template: TEMPLATE }).buildId
    put('assets/appleHealth.worker-C.js', 'changed')
    put('assets/libre-franklin-greek-wght-normal-E.woff2', 'changed')
    expect(emitServiceWorker({ outDir: dir, template: TEMPLATE }).buildId).toBe(before)
  })

  test('lists files with `/` separators, sorted', () => {
    build()
    expect(listFiles(dir)).toEqual([
      'assets/DoneSheet-B.js',
      'assets/appleHealth.worker-C.js',
      'assets/index-A.css',
      'assets/index-A.js',
      'assets/libre-franklin-greek-wght-normal-E.woff2',
      'assets/libre-franklin-latin-wght-normal-D.woff2',
      'icon-192.png',
      'index.html',
      'manifest.webmanifest',
    ])
  })
})

describe('the Vite plugin', () => {
  test('runs for a build only, and writes sw.js into the output folder after the bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-swplugin-'))
    try {
      writeFileSync(join(dir, 'index.html'), '<html>')
      const plugin = serviceWorkerPlugin()
      expect(plugin.apply).toBe('build')
      const messages: string[] = []
      const configResolved = plugin.configResolved as (config: unknown) => void
      configResolved({ root: dirname(dir), build: { outDir: dir } })
      const writeBundle = plugin.writeBundle as (this: { info: (m: string) => void }) => void
      writeBundle.call({ info: (message) => messages.push(message) })
      const written = readFileSync(join(dir, 'sw.js'), 'utf8')
      expect(constantsOf(written).precache).toEqual(['/index.html'])
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain(constantsOf(written).buildId)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the project depends on no service worker library', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]
    expect(names.filter((name) => /workbox|vite-plugin-pwa|service-worker/i.test(name))).toEqual([])
  })
})
