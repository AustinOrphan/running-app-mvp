import { parseArgs } from 'node:util'
import { RETENTION_RULE } from '../server/services/backup.ts'
import { deleteUser, planDeleteUser, type DeletePlan } from '../server/auth/deleteUser.ts'
import { loadConfig, loadEnvFileIfPresent } from '../server/config.ts'
import { createPrisma, initSqlite } from '../server/db.ts'

const USAGE = 'Usage: npm run delete-user -- <email> [--yes]\n'

function describeCounts(plan: DeletePlan): string {
  return plan.counts
    .filter((row) => row.count > 0)
    .map((row) => `  ${row.table}: ${String(row.count)}`)
    .join('\n')
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { yes: { type: 'boolean' } },
  })
  const [email, ...extra] = positionals
  if (!email || extra.length > 0) {
    process.stderr.write(USAGE)
    return 1
  }

  loadEnvFileIfPresent()
  const config = loadConfig(process.env)
  const prisma = createPrisma(config.databaseUrl)
  try {
    await initSqlite(prisma)
    if (!values.yes) {
      const plan = await planDeleteUser(prisma, email)
      process.stdout.write(
        `Would delete the account ${plan.email} and these rows:\n${describeCounts(plan)}\n` +
          'Nothing was deleted. Run again with --yes to delete.\n',
      )
      return 0
    }
    const plan = await deleteUser(prisma, email)
    process.stdout.write(
      `Deleted the account ${plan.email} and these rows:\n${describeCounts(plan)}\n` +
        'Its sessions ended with it: a cookie of the account is refused from now on.\n' +
        'The backups in backups/ still hold the account until they age out. The daily copies are ' +
        `pruned to keep ${RETENTION_RULE}, so the last one holding it goes within about 5 weeks. ` +
        'Pre-migration and pre-restore copies are never pruned automatically: delete those by ' +
        'hand if they must not keep it.\n' +
        'The live database file can still hold the deleted bytes (SQLite free pages and the WAL) ' +
        'until they are overwritten; VACUUM with the server stopped clears them.\n' +
        "Calendar events that the intervals.icu publisher wrote stay in that runner's own calendar.\n",
    )
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
