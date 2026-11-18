import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The release identity (RI1): the `version` of `package.json`, which a release tag `v<version>`
// names (`scripts/release.ts`). The image carries `package.json` beside `dist/`, so the same read
// works from source (`server/`) and from the build (`dist/server/`). No environment variable.

/** The version the server runs, or `unknown` when no `package.json` is found above this file. */
export function readAppVersion(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir
  for (;;) {
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
      } catch {
        // An unreadable file reads as no version.
      }
      return 'unknown'
    }
    const parent = dirname(dir)
    if (parent === dir) return 'unknown'
    dir = parent
  }
}

/** The version of this process, read once. */
export const APP_VERSION = readAppVersion()

/**
 * The start-up line: the version and the port the process runs. `port` stays last so that pino
 * writes `"port":N,"msg":"server listening"`: the readiness pattern of `webServer.wait` in
 * `playwright.config.ts` matches that exact sequence.
 */
export function logListening(logger: { info: (obj: object, msg: string) => void }, port: number) {
  logger.info({ version: APP_VERSION, port }, 'server listening')
}
