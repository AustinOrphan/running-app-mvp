import { resetToTemporaryPassword } from '../server/auth/createUser.ts'
import { loadConfig, loadEnvFileIfPresent } from '../server/config.ts'
import { createPrisma, initSqlite } from '../server/db.ts'

async function main(): Promise<number> {
  const email = process.argv[2]
  if (!email) {
    process.stderr.write('Usage: npm run reset-password -- <email>\n')
    return 1
  }

  loadEnvFileIfPresent()
  const config = loadConfig(process.env)

  const prisma = createPrisma(config.databaseUrl)
  try {
    await initSqlite(prisma)
    const temporaryPassword = await resetToTemporaryPassword(prisma, email)
    if (temporaryPassword === null) {
      process.stderr.write(`No account found for ${email}.\n`)
      return 1
    }
    // The password goes to stdout alone, so it can be captured; the words go to stderr.
    process.stderr.write(
      `Reset the password for ${email}. Every session is signed out and the next sign-in asks for a new password.\n` +
        'Temporary password (shown once, not stored anywhere):\n',
    )
    process.stdout.write(`${temporaryPassword}\n`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
