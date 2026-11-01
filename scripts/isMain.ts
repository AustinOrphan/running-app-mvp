import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Whether the module at `moduleUrl` (pass `import.meta.url`) is the script node was started with.
 * Both sides go through `realpathSync`: `process.argv[1]` keeps a symlinked path as it was typed
 * while the module URL is the real path, so comparing them as given made a script started through
 * a symlink (a linked checkout, `/tmp` on macOS) do nothing and exit 0.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1]
  if (entry === undefined || entry === '') return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}
