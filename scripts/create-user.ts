import { parseArgs } from 'node:util'
import { createUser } from '../server/auth/createUser.ts'
import { loadConfig, loadEnvFileIfPresent } from '../server/config.ts'
import { createPrisma, initSqlite } from '../server/db.ts'

const USAGE =
  'Usage: npm run create-user -- <email> [name] [--units km|mi] [--weight kg|lb] [--tz <IANA zone>]\n'

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      units: { type: 'string' },
      weight: { type: 'string' },
      tz: { type: 'string' },
    },
  })
  const [email, name, ...extra] = positionals
  if (!email || extra.length > 0) {
    process.stderr.write(USAGE)
    return 1
  }

  loadEnvFileIfPresent()
  const config = loadConfig(process.env)
  const prisma = createPrisma(config.databaseUrl)
  try {
    await initSqlite(prisma)
    const created = await createUser(prisma, {
      email,
      ...(name === undefined ? {} : { displayName: name }),
      ...(values.units === undefined ? {} : { units: values.units as 'mi' | 'km' }),
      ...(values.weight === undefined ? {} : { weightUnit: values.weight as 'lb' | 'kg' }),
      ...(values.tz === undefined ? {} : { timezone: values.tz }),
    })
    // The password goes to stdout alone, so it can be captured; the words go to stderr.
    process.stderr.write(
      `Created the account for ${created.email}. The first sign-in asks for a new password.\n` +
        'Temporary password (shown once, not stored anywhere):\n',
    )
    process.stdout.write(`${created.temporaryPassword}\n`)
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
