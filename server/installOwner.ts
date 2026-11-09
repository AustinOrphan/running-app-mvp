import type { PrismaClient } from './db.ts'

/**
 * The id of the install owner: the oldest account (`createdAt`, then `id` as a tie-break), or null
 * when there is no account. Every account is otherwise equal; the few server-side features that
 * reach the host (the Watched folder) belong to the owner alone.
 */
export async function installOwnerId(prisma: PrismaClient): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  return owner?.id ?? null
}

/** Whether `userId` is the install owner (see `installOwnerId`). */
export async function isInstallOwner(prisma: PrismaClient, userId: string): Promise<boolean> {
  return (await installOwnerId(prisma)) === userId
}
