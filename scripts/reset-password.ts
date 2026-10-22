import { createInterface } from 'node:readline'
import { loadConfig, loadEnvFileIfPresent } from '../server/config.ts'
import { createPrisma, initSqlite } from '../server/db.ts'
import { setPasswordByEmail } from '../server/auth/password.ts'

const CTRL_C = '\u0003'
const CTRL_D = '\u0004'

/** Reads one line with echo off. Piped input (not a TTY) supplies a single line instead. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const lines = createInterface({ input: process.stdin })
    for await (const line of lines) {
      lines.close()
      return line
    }
    return ''
  }

  process.stderr.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let value = ''
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === CTRL_C || char === CTRL_D) {
          process.stdin.setRawMode(false)
          process.stderr.write('\n')
          process.exit(130)
        }
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = [...value].slice(0, -1).join('')
        } else {
          value += char
        }
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main(): Promise<number> {
  const email = process.argv[2]
  if (!email) {
    process.stderr.write('Usage: npm run reset-password -- <email>\n')
    return 1
  }

  loadEnvFileIfPresent()
  const config = loadConfig(process.env)

  const password = await readSecret('New password: ')
  if (process.stdin.isTTY && (await readSecret('Repeat new password: ')) !== password) {
    process.stderr.write('The passwords do not match.\n')
    return 1
  }

  const prisma = createPrisma(config.databaseUrl)
  try {
    await initSqlite(prisma)
    const updated = await setPasswordByEmail(prisma, email, password)
    if (!updated) {
      process.stderr.write(`No account found for ${email}.\n`)
      return 1
    }
    process.stdout.write(`Password updated for ${email}.\n`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  const issues = (error as { details?: { issues?: Array<{ message: string }> } }).details?.issues
  const message =
    issues && issues.length > 0
      ? issues.map((issue) => issue.message).join(' ')
      : error instanceof Error
        ? error.message
        : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
