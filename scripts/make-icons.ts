// Renders the app's PNG icons from `web/public/icon.svg` with the Chromium that Playwright already
// installs for the end-to-end suite, so no image library is needed (ADR 0012). The PNGs are
// committed; run `npm run icons` after changing the SVG, then commit the four files.
//
// - `icon-192.png` and `icon-512.png`: the artwork as it is, for the manifest's `any` icons.
// - `icon-maskable-512.png`: the artwork at 80% on the same background, so a launcher that crops
//   the icon to a circle or a squircle still shows all of it (the safe zone of a maskable icon).
// - `apple-touch-icon.png` (180): the artwork on an opaque background, which iOS requires.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const PUBLIC_DIR = resolve(import.meta.dirname, '../web/public')

interface IconTarget {
  file: string
  size: number
  /** Scales the artwork into the safe zone of a maskable icon. */
  maskable: boolean
}

const TARGETS: readonly IconTarget[] = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
]

/** The background colour of the artwork, so the margin of a maskable icon matches it. */
const BACKGROUND = '#f6f6f9'
/** Share of the icon, per side, left empty around a maskable icon's artwork. */
const MASKABLE_MARGIN = '10%'

function pageFor(svg: string, maskable: boolean): string {
  const margin = maskable ? MASKABLE_MARGIN : '0'
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:${BACKGROUND}}
body{box-sizing:border-box;padding:${margin}}
svg{display:block;width:100%;height:100%}
</style><body>${svg}</body>`
}

async function main(): Promise<void> {
  const svg = readFileSync(resolve(PUBLIC_DIR, 'icon.svg'), 'utf8')
  const browser = await chromium.launch()
  try {
    for (const { file, size, maskable } of TARGETS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } })
      await page.setContent(pageFor(svg, maskable))
      const png = await page.screenshot({ type: 'png' })
      writeFileSync(resolve(PUBLIC_DIR, file), png)
      await page.close()
      process.stdout.write(`${file} ${String(size)}x${String(size)}\n`)
    }
  } finally {
    await browser.close()
  }
}

await main()
