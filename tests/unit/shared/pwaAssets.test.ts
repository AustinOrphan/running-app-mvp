// The files that make the app installable (phase 3a design 7.6, ADR 0012): the four PNG icons, the
// manifest and the page's head. They are static, so what they promise is checked against the disk.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const PUBLIC_DIR = resolve(import.meta.dirname, '../../../web/public')
const read = (path: string): Buffer => readFileSync(resolve(PUBLIC_DIR, path))

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The width and height in the IHDR chunk, which must be the first chunk of a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'a PNG signature').toBe(true)
  expect(bytes.subarray(12, 16).toString('ascii'), 'the first chunk').toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('the PNG icons', () => {
  test.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ])('%s is %d by %d pixels', (file, size) => {
    expect(pngSize(read(file))).toEqual({ width: size, height: size })
  })

  test('the maskable icon is not the plain one: its artwork is scaled into the safe zone', () => {
    expect(read('icon-maskable-512.png').equals(read('icon-512.png'))).toBe(false)
  })
})

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}
interface Manifest {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
  shortcuts: Array<{ name: string; url: string; icons?: ManifestIcon[] }>
}
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8')) as Manifest

describe('the manifest', () => {
  test('names the app by id, start page and scope', () => {
    expect(manifest.id).toBe('/')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toBe('Running log')
    expect(manifest.short_name).toBe('Running log')
  })

  test('has two shortcuts, each to a page of the app', () => {
    expect(manifest.shortcuts).toHaveLength(2)
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.name).not.toBe('')
      expect(shortcut.url.startsWith('/')).toBe(true)
      expect(shortcut.url.startsWith(manifest.scope)).toBe(true)
    }
  })

  test('lists the 192 and 512 icons for any use and a 512 maskable one', () => {
    const find = (sizes: string, purpose: string) =>
      manifest.icons.find((icon) => icon.sizes === sizes && icon.purpose === purpose)
    expect(find('192x192', 'any')?.src).toBe('/icon-192.png')
    expect(find('512x512', 'any')?.src).toBe('/icon-512.png')
    expect(find('512x512', 'maskable')?.src).toBe('/icon-maskable-512.png')
  })

  test('every file it names exists, with the size it claims', () => {
    const named = [...manifest.icons, ...manifest.shortcuts.flatMap((s) => s.icons ?? [])]
    for (const icon of named) {
      expect(existsSync(resolve(PUBLIC_DIR, icon.src.slice(1))), icon.src).toBe(true)
      if (icon.type === 'image/png') {
        const [width, height] = icon.sizes.split('x').map(Number)
        expect(pngSize(read(icon.src.slice(1))), icon.src).toEqual({ width, height })
      }
    }
  })

  test('uses the colours of the page head', () => {
    expect(manifest.theme_color).toBe(metaContent('theme-color'))
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

const indexHtml = readFileSync(resolve(PUBLIC_DIR, '../index.html'), 'utf8')

function metaContent(name: string): string | undefined {
  return new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`).exec(indexHtml)?.[1]
}

describe('the page head', () => {
  test('links the manifest, the vector icon and the 180 pixel touch icon, all of which exist', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(indexHtml).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />')
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    for (const file of ['manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png']) {
      expect(existsSync(resolve(PUBLIC_DIR, file)), file).toBe(true)
    }
  })

  test('asks for the standalone look on iOS and Android', () => {
    expect(metaContent('apple-mobile-web-app-capable')).toBe('yes')
    expect(metaContent('mobile-web-app-capable')).toBe('yes')
    expect(metaContent('apple-mobile-web-app-title')).toBe('Running log')
    expect(metaContent('theme-color')).toBe('#3a36b5')
  })

  test('keeps the viewport that lets the page use the whole screen', () => {
    expect(metaContent('viewport')).toContain('viewport-fit=cover')
  })
})
