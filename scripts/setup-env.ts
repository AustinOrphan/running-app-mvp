import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SECRET_LINE = /^SESSION_SECRET=(.*)$/m

/**
 * Makes sure an env file exists and holds a SESSION_SECRET. Copies the example file when the env
 * file is missing, fills an empty or absent secret with random bytes, and leaves every other line
 * and any non-empty secret untouched.
 */
export function ensureEnvFile(
  envPath: string,
  examplePath: string,
): { created: boolean; generatedSecret: boolean } {
  let created = false
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath)
    created = true
  }

  const text = readFileSync(envPath, 'utf8')
  const match = SECRET_LINE.exec(text)
  const current = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? ''
  if (current !== '') return { created, generatedSecret: false }

  const secret = randomBytes(48).toString('base64')
  const next = match
    ? text.replace(SECRET_LINE, () => `SESSION_SECRET=${secret}`)
    : `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}SESSION_SECRET=${secret}\n`
  writeFileSync(envPath, next, { mode: 0o600 })
  return { created, generatedSecret: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = ensureEnvFile('.env', '.env.example')
  console.log(result.created ? 'Created .env from .env.example.' : '.env already exists.')
  console.log(
    result.generatedSecret
      ? 'Generated a SESSION_SECRET.'
      : 'SESSION_SECRET already set; left unchanged.',
  )
}
